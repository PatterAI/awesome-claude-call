import { loadCredentials } from './credentials.js';
import { redactPhone } from './redact.js';

interface Check { name: string; ok: boolean; detail?: string; }

async function checkTwilio(sid: string, token: string): Promise<Check> {
  try {
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (res.ok) return { name: 'Twilio auth', ok: true, detail: `account ${sid.slice(0, 4)}***${sid.slice(-4)}` };
    return { name: 'Twilio auth', ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { name: 'Twilio auth', ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function checkOpenAI(key: string): Promise<Check> {
  try {
    const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    if (res.ok) return { name: 'OpenAI API reachable', ok: true };
    return { name: 'OpenAI API reachable', ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { name: 'OpenAI API reachable', ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function checkElevenLabs(key: string): Promise<Check> {
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': key } });
    if (res.ok) return { name: 'ElevenLabs API reachable', ok: true };
    return { name: 'ElevenLabs API reachable', ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { name: 'ElevenLabs API reachable', ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function checkDeepgram(key: string): Promise<Check> {
  try {
    const res = await fetch('https://api.deepgram.com/v1/projects', { headers: { Authorization: `Token ${key}` } });
    if (res.ok) return { name: 'Deepgram API reachable', ok: true };
    return { name: 'Deepgram API reachable', ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { name: 'Deepgram API reachable', ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function runDoctor(): Promise<number> {
  process.stdout.write('claude-call doctor\n');
  const checks: Check[] = [];
  try {
    const creds = await loadCredentials();
    checks.push({
      name: 'Credentials parsed', ok: true,
      detail: `engine=${creds.VOICE_ENGINE}, phone=${redactPhone(creds.TWILIO_PHONE_NUMBER)}`,
    });
    checks.push(await checkTwilio(creds.TWILIO_ACCOUNT_SID, creds.TWILIO_AUTH_TOKEN));
    if (creds.OPENAI_API_KEY) checks.push(await checkOpenAI(creds.OPENAI_API_KEY));
    if (creds.ELEVENLABS_API_KEY) checks.push(await checkElevenLabs(creds.ELEVENLABS_API_KEY));
    if (creds.DEEPGRAM_API_KEY) checks.push(await checkDeepgram(creds.DEEPGRAM_API_KEY));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    checks.push({ name: 'Credentials', ok: false, detail: message });
  }

  let allOk = true;
  for (const c of checks) {
    const mark = c.ok ? '✓' : '✗';
    const line = c.detail ? `${mark} ${c.name} (${c.detail})\n` : `${mark} ${c.name}\n`;
    process.stdout.write(line);
    if (!c.ok) allOk = false;
  }
  process.stdout.write(allOk ? 'All checks passed.\n' : 'One or more checks failed.\n');
  return allOk ? 0 : 1;
}
