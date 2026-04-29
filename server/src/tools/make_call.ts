import type { Tool } from 'getpatter';
import { ToolError } from '../errors.js';
import type { PatterContext } from '../patter.js';
import { appendCall, type CallRecord } from '../store.js';
import { logEvent } from '../log.js';

const E164 = /^\+[1-9]\d{1,14}$/;
const SYSTEM_PROMPT_MAX = 8000;
const AI_DISCLOSURE =
  'Identify yourself on the first turn as "an AI assistant calling on behalf of Francesco". If asked whether you are human, answer truthfully.';

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

export async function makeCall(ctx: PatterContext, raw: Partial<MakeCallInput>): Promise<MakeCallOutput> {
  const input = validateMakeCallInput(raw);
  const startedAt = new Date().toISOString();
  const systemPrompt = `${input.system_prompt}\n\n[Hard rule] ${AI_DISCLOSURE}`;
  void logEvent({ event: 'call_dispatch', to: input.to });

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

  // Patter generates its own call_id (from Twilio's SID). Grab the most-recent
  // record from MetricsStore; that's the call we just completed.
  const store = ctx.patter.metricsStore;
  const recent = store?.getCalls(1, 0) ?? [];
  const record = recent[0] as
    | { call_id?: string; status?: string; duration_seconds?: number; cost_usd?: number; transcript?: unknown[] }
    | undefined;

  const callId = String(record?.call_id ?? `unknown-${Date.now()}`);
  const status = (record?.status as CallRecord['status']) ?? 'completed';
  const duration = typeof record?.duration_seconds === 'number' ? record.duration_seconds : 0;
  const cost = typeof record?.cost_usd === 'number' ? record.cost_usd : undefined;
  const endedAt = new Date().toISOString();

  const transcript: MakeCallOutput['transcript'] = [];
  if (Array.isArray(record?.transcript)) {
    for (const t of record.transcript as { role?: string; text?: string; ts?: string }[]) {
      transcript.push({
        role: t.role === 'user' ? 'user' : 'agent',
        text: String(t.text ?? ''),
        ts: String(t.ts ?? endedAt),
      });
    }
  }

  await appendCall({
    call_id: callId,
    to: input.to,
    status,
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: duration,
    cost_usd: cost,
    transcript,
  });

  void logEvent({ event: 'call_completed', call_id: callId, to: input.to, status, duration });
  return { call_id: callId, status, duration_seconds: duration, transcript, cost_usd: cost };
}
