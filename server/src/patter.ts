import {
  Patter,
  Twilio,
  OpenAIRealtime,
  ElevenLabsConvAI,
  CloudflareTunnel,
  type Tool,
  type ServeOptions,
} from 'getpatter';
import type { Credentials, VoiceEngine } from './credentials.js';
import { logEvent } from './log.js';

export interface PatterContext {
  patter: Patter;
  engine: VoiceEngine;
  phoneNumber: string;
  engineInstance: OpenAIRealtime | ElevenLabsConvAI | undefined;
  credentials: Credentials;
}

export type ServingMode = 'outbound' | 'inbound';

export interface ServingTarget {
  mode: ServingMode;
  systemPrompt: string;
  firstMessage?: string;
  tools?: Tool[];
  // Match the SDK's ServeOptions['onTranscript'] exactly so it round-trips
  // through `phone.serve(...)` without a type cast.
  onTranscript?: (data: Record<string, unknown>) => Promise<void>;
}

let cached: PatterContext | undefined;
let servingState: { mode: ServingMode; promise: Promise<void>; key: string } | null = null;

function targetKey(t: ServingTarget): string {
  // Sort tool names so reordering the input array doesn't trigger a spurious
  // disconnect+reconnect when the agent identity is logically the same.
  const toolNames = [...(t.tools ?? [])].map((x) => x.name).sort().join(',');
  return JSON.stringify({
    m: t.mode,
    p: t.systemPrompt,
    f: t.firstMessage ?? '',
    tn: toolNames,
  });
}

export function buildPatter(creds: Credentials): PatterContext {
  if (cached && cached.credentials === creds) return cached;
  const carrier = new Twilio({ accountSid: creds.TWILIO_ACCOUNT_SID, authToken: creds.TWILIO_AUTH_TOKEN });
  const patter = new Patter({
    carrier,
    phoneNumber: creds.TWILIO_PHONE_NUMBER,
    tunnel: new CloudflareTunnel(),
  });
  let engineInstance: OpenAIRealtime | ElevenLabsConvAI | undefined;
  if (creds.VOICE_ENGINE === 'openai_realtime' && creds.OPENAI_API_KEY) {
    engineInstance = new OpenAIRealtime({ apiKey: creds.OPENAI_API_KEY });
  } else if (creds.VOICE_ENGINE === 'elevenlabs_convai' && creds.ELEVENLABS_API_KEY && creds.ELEVENLABS_AGENT_ID) {
    engineInstance = new ElevenLabsConvAI({ apiKey: creds.ELEVENLABS_API_KEY, agentId: creds.ELEVENLABS_AGENT_ID });
  }
  cached = { patter, engine: creds.VOICE_ENGINE, phoneNumber: creds.TWILIO_PHONE_NUMBER, engineInstance, credentials: creds };
  void logEvent({ event: 'patter_built', engine: creds.VOICE_ENGINE });
  return cached;
}

/**
 * Ensure the bundled Patter server is serving with the given agent.
 *
 * The SDK stores exactly one agent per `serve()` call (`embeddedServer.this.agent`).
 * The agent passed to `phone.call()` is currently ignored by the SDK — the
 * webhook routes ALL audio to the serving agent. So to place an outbound call
 * with a custom agent, we must serve() with that agent first.
 *
 * If already serving with the same agent identity (mode + prompt + firstMessage
 * + tool names), this is a no-op. Otherwise it disconnects the prior tunnel
 * and re-spawns with the new agent — costs ~3-5s for Cloudflare to bind.
 */
export async function ensureServing(ctx: PatterContext, target: ServingTarget): Promise<void> {
  const key = targetKey(target);
  if (servingState?.key === key) return servingState.promise;
  if (servingState) {
    await servingState.promise.catch(() => undefined);
    try {
      await ctx.patter.disconnect();
    } catch (err) {
      void logEvent({ event: 'serving_disconnect_failed', error: err instanceof Error ? err.message : String(err) });
    }
    servingState = null;
  }
  const serveOpts: ServeOptions = {
    agent: {
      systemPrompt: target.systemPrompt,
      ...(target.firstMessage ? { firstMessage: target.firstMessage } : {}),
      ...(target.tools ? { tools: target.tools } : {}),
      ...(ctx.engineInstance ? { engine: ctx.engineInstance } : {}),
    },
    ...(target.onTranscript ? { onTranscript: target.onTranscript } : {}),
  };
  const promise = ctx.patter.serve(serveOpts);
  servingState = { mode: target.mode, promise, key };
  void logEvent({ event: 'serving_started', mode: target.mode });
  await promise;
}

export async function stopServing(ctx: PatterContext): Promise<void> {
  if (!servingState) return;
  await servingState.promise.catch(() => undefined);
  try {
    await ctx.patter.disconnect();
  } catch (err) {
    void logEvent({ event: 'serving_disconnect_failed', error: err instanceof Error ? err.message : String(err) });
  }
  servingState = null;
  void logEvent({ event: 'serving_stopped' });
}

export function currentServingMode(): ServingMode | null {
  return servingState?.mode ?? null;
}

export async function disposePatter(): Promise<void> {
  if (!cached) return;
  try {
    await cached.patter.disconnect();
  } catch (err) {
    void logEvent({ event: 'patter_dispose_error', error: String(err) });
  }
  cached = undefined;
  servingState = null;
}

export function __resetForTests(): void {
  cached = undefined;
  servingState = null;
}
