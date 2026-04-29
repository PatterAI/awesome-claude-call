import {
  Patter,
  Twilio,
  OpenAIRealtime,
  ElevenLabsConvAI,
  CloudflareTunnel,
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

let cached: PatterContext | undefined;

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

export async function disposePatter(): Promise<void> {
  if (!cached) return;
  try {
    await cached.patter.disconnect();
  } catch (err) {
    void logEvent({ event: 'patter_dispose_error', error: String(err) });
  }
  cached = undefined;
}
