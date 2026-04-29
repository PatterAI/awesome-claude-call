import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendCall, listCalls, getCall, type CallRecord } from '../../src/store.js';

let dir: string;
let path: string;

const REC: CallRecord = {
  call_id: 'CA1',
  to: '+15551234567',
  status: 'completed',
  started_at: '2026-04-28T10:00:00Z',
  ended_at: '2026-04-28T10:00:30Z',
  duration_seconds: 30,
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cc-store-'));
  path = join(dir, 'calls.ndjson');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('store', () => {
  it('appendCall + listCalls round-trips a record', async () => {
    await appendCall(REC, path);
    const calls = await listCalls({}, path);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].call_id, 'CA1');
    assert.equal(calls[0].duration_seconds, 30);
  });

  it('listCalls returns most-recent-first by started_at', async () => {
    await appendCall({ ...REC, call_id: 'CA1', started_at: '2026-04-28T09:00:00Z' }, path);
    await appendCall({ ...REC, call_id: 'CA2', started_at: '2026-04-28T10:00:00Z' }, path);
    const calls = await listCalls({}, path);
    assert.equal(calls[0].call_id, 'CA2');
    assert.equal(calls[1].call_id, 'CA1');
  });

  it('listCalls respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await appendCall({ ...REC, call_id: `CA${i}`, started_at: `2026-04-28T1${i}:00:00Z` }, path);
    }
    const calls = await listCalls({ limit: 2 }, path);
    assert.equal(calls.length, 2);
  });

  it('listCalls filters by since', async () => {
    await appendCall({ ...REC, call_id: 'CA1', started_at: '2026-04-28T09:00:00Z' }, path);
    await appendCall({ ...REC, call_id: 'CA2', started_at: '2026-04-28T10:00:00Z' }, path);
    const calls = await listCalls({ since: '2026-04-28T09:30:00Z' }, path);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].call_id, 'CA2');
  });

  it('getCall returns null for unknown id', async () => {
    await appendCall(REC, path);
    assert.equal(await getCall('UNKNOWN', path), null);
  });

  it('getCall returns the matching record', async () => {
    await appendCall(REC, path);
    const found = await getCall('CA1', path);
    assert.equal(found?.call_id, 'CA1');
  });

  it('listCalls returns empty when file does not exist', async () => {
    assert.deepEqual(await listCalls({}, path), []);
  });
});
