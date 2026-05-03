import type { Tool } from 'getpatter';
import { ToolError } from '../errors.js';
import type { PatterContext } from '../patter.js';
import { ensureServing } from '../patter.js';
import { appendCall, type CallRecord } from '../store.js';
import { logEvent } from '../log.js';

const E164 = /^\+[1-9]\d{1,14}$/;
const SYSTEM_PROMPT_MAX = 8000;
const AI_DISCLOSURE =
  'Identify yourself on the first turn as "an AI assistant calling on behalf of Francesco". If asked whether you are human, answer truthfully.';
const DIAL_CAPTURE_TIMEOUT_MS = 30_000;
const DEFAULT_CALL_TIMEOUT_MS = 300_000;

function callTimeoutMs(): number {
  const raw = process.env.CLAUDE_CALL_TIMEOUT_MS;
  if (!raw) return DEFAULT_CALL_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CALL_TIMEOUT_MS;
}

export interface MakeCallInput {
  to: string;
  system_prompt: string;
  first_message?: string;
  recording?: boolean;
  voicemail_message?: string;
  tools?: Tool[];
}

export interface MakeCallOutput {
  call_id: string;
  status: CallRecord['status'];
  duration_seconds: number;
  transcript: { role: 'agent' | 'user'; text: string; ts: string }[];
  cost_usd?: number;
}

export function validateMakeCallInput(input: Partial<MakeCallInput>): MakeCallInput {
  if (!input.to || !E164.test(input.to)) {
    throw new ToolError('invalid_input', 'to must be E.164 (e.g. +15551234567)');
  }
  if (!input.system_prompt) {
    throw new ToolError('invalid_input', 'system_prompt is required');
  }
  if (input.system_prompt.length > SYSTEM_PROMPT_MAX) {
    throw new ToolError('invalid_input', `system_prompt exceeds ${SYSTEM_PROMPT_MAX} chars`);
  }
  return {
    to: input.to,
    system_prompt: input.system_prompt,
    first_message: input.first_message,
    recording: input.recording ?? false,
    voicemail_message: input.voicemail_message,
    tools: input.tools,
  };
}

interface MetricsStoreLike {
  on(event: string, listener: (event: SseEvent) => void): unknown;
  off(event: string, listener: (event: SseEvent) => void): unknown;
  getCall(callId: string): unknown;
}

interface SseEvent {
  type: string;
  data?: { call_id?: string; [k: string]: unknown };
}

interface RecordLike {
  call_id?: string;
  status?: string;
  caller?: string;
  callee?: string;
  started_at?: number;
  ended_at?: number;
  transcript?: { role?: string; text?: string; timestamp?: number; ts?: string | number }[];
  cost_usd?: number;
  metrics?: Record<string, unknown> | null;
  duration_seconds?: number;
}

function awaitCallInitiated(store: MetricsStoreLike): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      store.off('sse', listener);
      reject(new ToolError('call_failed', `did not observe call_initiated within ${DIAL_CAPTURE_TIMEOUT_MS}ms`));
    }, DIAL_CAPTURE_TIMEOUT_MS);
    const listener = (event: SseEvent): void => {
      if (event.type !== 'call_initiated') return;
      const id = event.data?.call_id;
      if (!id || typeof id !== 'string') return;
      clearTimeout(timer);
      store.off('sse', listener);
      resolve(id);
    };
    store.on('sse', listener);
  });
}

function awaitCallEnd(store: MetricsStoreLike, callId: string, timeoutMs: number): Promise<RecordLike> {
  return new Promise<RecordLike>((resolve, reject) => {
    const timer = setTimeout(() => {
      store.off('sse', listener);
      reject(new ToolError('call_failed', `call ${callId} exceeded ${timeoutMs}ms timeout`));
    }, timeoutMs);
    const listener = (event: SseEvent): void => {
      if (event.type !== 'call_end') return;
      if (event.data?.call_id !== callId) return;
      clearTimeout(timer);
      store.off('sse', listener);
      resolve((event.data ?? {}) as RecordLike);
    };
    store.on('sse', listener);
  });
}

function transcriptFromRecord(rec: RecordLike, fallbackTs: string): MakeCallOutput['transcript'] {
  const out: MakeCallOutput['transcript'] = [];
  if (!Array.isArray(rec.transcript)) return out;
  for (const t of rec.transcript) {
    const role: 'user' | 'agent' = t.role === 'user' ? 'user' : 'agent';
    let ts = fallbackTs;
    if (typeof t.ts === 'string') ts = t.ts;
    else if (typeof t.ts === 'number') ts = new Date(t.ts).toISOString();
    else if (typeof t.timestamp === 'number') ts = new Date(t.timestamp).toISOString();
    out.push({ role, text: String(t.text ?? ''), ts });
  }
  return out;
}

export async function makeCall(ctx: PatterContext, raw: Partial<MakeCallInput>): Promise<MakeCallOutput> {
  const input = validateMakeCallInput(raw);
  const startedAt = new Date().toISOString();
  const systemPrompt = `${input.system_prompt}\n\n[Hard rule] ${AI_DISCLOSURE}`;
  void logEvent({ event: 'call_dispatch', to: input.to });

  // Twilio needs a public webhook to deliver call audio. Spawn the Cloudflare
  // tunnel lazily on first call. The Patter SDK stores exactly one agent on
  // the embedded server and routes ALL call audio (inbound + outbound) to it,
  // so we must serve() with THIS call's agent before dialing — the `agent`
  // arg to `phone.call()` is currently ignored by the SDK.
  await ensureServing(ctx, {
    mode: 'outbound',
    systemPrompt,
    firstMessage: input.first_message,
    tools: input.tools,
  });

  const store = ctx.patter.metricsStore as unknown as MetricsStoreLike | null;
  if (!store) {
    throw new ToolError('call_failed', 'metricsStore is null after serve() — cannot track call lifecycle');
  }

  // Subscribe BEFORE dialing so we don't miss the call_initiated event.
  const initiatedPromise = awaitCallInitiated(store);

  try {
    await ctx.patter.call({
      to: input.to,
      agent: {
        systemPrompt,
        firstMessage: input.first_message,
        tools: input.tools,
        ...(ctx.engineInstance ? { engine: ctx.engineInstance } : {}),
      },
      voicemailMessage: input.voicemail_message,
    });
  } catch (err) {
    void logEvent({ event: 'call_failed', to: input.to, error: String(err) });
    throw err;
  }

  const callId = await initiatedPromise;
  void logEvent({ event: 'call_initiated', call_id: callId, to: input.to });

  const endData = await awaitCallEnd(store, callId, callTimeoutMs());

  // Prefer the full record from the store (richer than the SSE event payload).
  const record = (store.getCall(callId) as RecordLike | null) ?? endData;
  const status = (record.status as CallRecord['status']) ?? 'completed';
  // The Patter SDK records `started_at` / `ended_at` as Unix seconds
  // (`Date.now() / 1e3` in MetricsStore). Convert to ms for our internal use.
  // Heuristic for forward-compat: values > 1e11 are already ms; otherwise seconds.
  const toMs = (v: unknown): number | null => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
    return v > 1e11 ? v : v * 1000;
  };
  const startedMs = toMs(record.started_at) ?? Date.parse(startedAt);
  const endedMs = toMs(record.ended_at) ?? Date.now();
  const duration = Math.max(0, Math.round((endedMs - startedMs) / 1000));
  const cost = typeof record.cost_usd === 'number' ? record.cost_usd : undefined;
  const endedAtIso = new Date(endedMs).toISOString();
  const transcript = transcriptFromRecord(record, endedAtIso);

  await appendCall({
    call_id: callId,
    to: input.to,
    status,
    started_at: startedAt,
    ended_at: endedAtIso,
    duration_seconds: duration,
    cost_usd: cost,
    transcript,
  });

  void logEvent({ event: 'call_completed', call_id: callId, to: input.to, status, duration });
  return { call_id: callId, status, duration_seconds: duration, transcript, cost_usd: cost };
}
