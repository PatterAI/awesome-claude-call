import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type VoiceEngine = 'openai_realtime' | 'elevenlabs_convai' | 'pipeline';

export interface Credentials {
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_PHONE_NUMBER: string;
  VOICE_ENGINE: VoiceEngine;
  OPENAI_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_AGENT_ID?: string;
  DEEPGRAM_API_KEY?: string;
}

export class CredentialsError extends Error {
  constructor(public code: 'credentials_missing' | 'credentials_invalid', message: string) {
    super(message);
    this.name = 'CredentialsError';
  }
}

const VALID_ENGINES: VoiceEngine[] = ['openai_realtime', 'elevenlabs_convai', 'pipeline'];
const E164 = /^\+[1-9]\d{1,14}$/;
const TWILIO_SID = /^AC[0-9a-fA-F]{32}$/;

export function defaultCredentialsPath(): string {
  return process.env.CLAUDE_CALL_CREDENTIALS ?? join(homedir(), '.claude-call', 'credentials');
}

export function parseCredentials(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function validate(parsed: Record<string, string>): Credentials {
  const required = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'VOICE_ENGINE'];
  for (const key of required) {
    if (!parsed[key]) {
      throw new CredentialsError('credentials_invalid', `Missing required credential: ${key}`);
    }
  }
  if (!TWILIO_SID.test(parsed.TWILIO_ACCOUNT_SID)) {
    throw new CredentialsError('credentials_invalid', 'TWILIO_ACCOUNT_SID format invalid (expected AC + 32 hex)');
  }
  if (!E164.test(parsed.TWILIO_PHONE_NUMBER)) {
    throw new CredentialsError('credentials_invalid', 'TWILIO_PHONE_NUMBER must be E.164 (e.g. +15551234567)');
  }
  if (!VALID_ENGINES.includes(parsed.VOICE_ENGINE as VoiceEngine)) {
    throw new CredentialsError('credentials_invalid', `VOICE_ENGINE must be one of: ${VALID_ENGINES.join(', ')}`);
  }
  const engine = parsed.VOICE_ENGINE as VoiceEngine;
  if (engine === 'openai_realtime' && !parsed.OPENAI_API_KEY) {
    throw new CredentialsError('credentials_invalid', 'OPENAI_API_KEY required for openai_realtime engine');
  }
  if (engine === 'elevenlabs_convai' && (!parsed.ELEVENLABS_API_KEY || !parsed.ELEVENLABS_AGENT_ID)) {
    throw new CredentialsError('credentials_invalid', 'ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID required for elevenlabs_convai engine');
  }
  if (engine === 'pipeline' && (!parsed.OPENAI_API_KEY || !parsed.DEEPGRAM_API_KEY || !parsed.ELEVENLABS_API_KEY)) {
    throw new CredentialsError('credentials_invalid', 'OPENAI_API_KEY, DEEPGRAM_API_KEY, and ELEVENLABS_API_KEY required for pipeline engine');
  }
  return {
    TWILIO_ACCOUNT_SID: parsed.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: parsed.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: parsed.TWILIO_PHONE_NUMBER,
    VOICE_ENGINE: engine,
    OPENAI_API_KEY: parsed.OPENAI_API_KEY,
    ELEVENLABS_API_KEY: parsed.ELEVENLABS_API_KEY,
    ELEVENLABS_AGENT_ID: parsed.ELEVENLABS_AGENT_ID,
    DEEPGRAM_API_KEY: parsed.DEEPGRAM_API_KEY,
  };
}

export async function loadCredentials(path?: string): Promise<Credentials> {
  const target = path ?? defaultCredentialsPath();
  let info;
  try {
    info = await stat(target);
  } catch {
    throw new CredentialsError('credentials_missing', `Credentials file not found at ${target}. Run /claude-call:setup.`);
  }
  // Refuse world- or group-readable files (mode bits outside owner must be 0)
  const mode = info.mode & 0o077;
  if (mode !== 0) {
    throw new CredentialsError('credentials_invalid', `Credentials file ${target} has overly permissive mode. Run: chmod 0600 ${target}`);
  }
  const content = await readFile(target, 'utf8');
  const parsed = parseCredentials(content);
  return validate(parsed);
}
