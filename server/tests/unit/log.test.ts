import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logEvent } from '../../src/log.js';

let dir: string;
let logPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cc-log-'));
  logPath = join(dir, 'log.ndjson');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('logEvent', () => {
  it('appends a JSON line with ISO ts and event field', async () => {
    await logEvent({ event: 'test', ok: true }, logPath);
    const line = readFileSync(logPath, 'utf8').trim();
    const parsed = JSON.parse(line);
    assert.equal(parsed.event, 'test');
    assert.equal(parsed.ok, true);
    assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('redacts phone-number fields automatically', async () => {
    await logEvent({ event: 'call', to: '+15555550100', from: '+15551234567' }, logPath);
    const line = readFileSync(logPath, 'utf8').trim();
    const parsed = JSON.parse(line);
    assert.equal(parsed.to, '+39******4567');
    assert.equal(parsed.from, '+15*****4567');
  });

  it('appends multiple lines preserving order', async () => {
    await logEvent({ event: 'a' }, logPath);
    await logEvent({ event: 'b' }, logPath);
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).event, 'a');
    assert.equal(JSON.parse(lines[1]).event, 'b');
  });
});
