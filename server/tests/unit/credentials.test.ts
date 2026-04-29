import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCredentials, parseCredentials, CredentialsError } from '../../src/credentials.js';

let dir: string;
let credPath: string;

const MIN_CREDS = `
TWILIO_ACCOUNT_SID=AC00000000000000000000000000000000
TWILIO_AUTH_TOKEN=tok123
TWILIO_PHONE_NUMBER=+15551234567
VOICE_ENGINE=openai_realtime
OPENAI_API_KEY=sk-test
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cc-creds-'));
  credPath = join(dir, 'credentials');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('parseCredentials', () => {
  it('parses KEY=VALUE pairs ignoring comments and blank lines', () => {
    const parsed = parseCredentials('# header\n\nFOO=bar\nBAZ=qux\n');
    assert.deepEqual(parsed, { FOO: 'bar', BAZ: 'qux' });
  });

  it('preserves equals signs in values', () => {
    const parsed = parseCredentials('TOKEN=abc=def=ghi');
    assert.equal(parsed.TOKEN, 'abc=def=ghi');
  });

  it('trims surrounding whitespace from keys and values', () => {
    const parsed = parseCredentials('  KEY  =  value  ');
    assert.equal(parsed.KEY, 'value');
  });
});

describe('loadCredentials', () => {
  it('loads valid credentials and returns typed object', async () => {
    writeFileSync(credPath, MIN_CREDS, 'utf8');
    chmodSync(credPath, 0o600);
    const creds = await loadCredentials(credPath);
    assert.equal(creds.TWILIO_ACCOUNT_SID, 'AC00000000000000000000000000000000');
    assert.equal(creds.VOICE_ENGINE, 'openai_realtime');
    assert.equal(creds.OPENAI_API_KEY, 'sk-test');
  });

  it('throws credentials_missing when file is absent', async () => {
    await assert.rejects(loadCredentials(credPath), (e) => (e as { code?: string }).code === 'credentials_missing');
  });

  it('throws credentials_invalid when required key is missing', async () => {
    writeFileSync(credPath, 'TWILIO_ACCOUNT_SID=AC1\n', 'utf8');
    chmodSync(credPath, 0o600);
    await assert.rejects(loadCredentials(credPath), (e) => e instanceof CredentialsError);
  });

  it('throws credentials_invalid when phone number is not E.164', async () => {
    const bad = MIN_CREDS.replace('+15551234567', '5551234567');
    writeFileSync(credPath, bad, 'utf8');
    chmodSync(credPath, 0o600);
    await assert.rejects(loadCredentials(credPath), (e) => (e as { code?: string }).code === 'credentials_invalid');
  });

  it('refuses world-readable credentials file', async () => {
    writeFileSync(credPath, MIN_CREDS, 'utf8');
    chmodSync(credPath, 0o644);
    await assert.rejects(loadCredentials(credPath), (e) => (e as { code?: string }).code === 'credentials_invalid');
  });

  it('requires VOICE_ENGINE-specific key (elevenlabs_convai needs ELEVENLABS_*)', async () => {
    const content = MIN_CREDS
      .replace('VOICE_ENGINE=openai_realtime', 'VOICE_ENGINE=elevenlabs_convai')
      .replace('OPENAI_API_KEY=sk-test', '');
    writeFileSync(credPath, content, 'utf8');
    chmodSync(credPath, 0o600);
    await assert.rejects(loadCredentials(credPath), (e) => (e as { code?: string }).code === 'credentials_invalid');
  });
});
