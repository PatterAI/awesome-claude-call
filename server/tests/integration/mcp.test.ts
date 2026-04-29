import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let proc: ChildProcess;
let dir: string;
let buf = '';
const pending = new Map<number, (msg: unknown) => void>();

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'cc-mcp-'));
  proc = spawn('node', ['dist/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLAUDE_CALL_CREDENTIALS: join(dir, 'no-credentials'),  // intentionally missing
      CLAUDE_CALL_LOG: join(dir, 'log.ndjson'),
      CLAUDE_CALL_STORE: join(dir, 'calls.ndjson'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  proc.stdout?.on('data', (chunk: Buffer) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as { id?: number };
        if (typeof parsed.id === 'number') {
          const cb = pending.get(parsed.id);
          if (cb) {
            pending.delete(parsed.id);
            cb(parsed);
          }
        }
      } catch { /* skip */ }
    }
  });
});

after(() => {
  proc?.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
});

function send(req: { id: number } & Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    pending.set(req.id, resolve);
    setTimeout(() => {
      if (pending.has(req.id)) {
        pending.delete(req.id);
        reject(new Error(`MCP request ${req.id} timed out`));
      }
    }, 5000);
    proc.stdin?.write(JSON.stringify(req) + '\n');
  });
}

describe('MCP server (stdio)', () => {
  it('responds to initialize', async () => {
    const res = await send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
    });
    const r = res as { id: number; result: { protocolVersion: string } };
    assert.equal(r.id, 1);
    assert.ok(typeof r.result.protocolVersion === 'string');
  });

  it('lists 4 tools', async () => {
    const res = await send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) as { result: { tools: { name: string }[] } };
    const names = res.result.tools.map((t) => t.name);
    for (const expected of ['make_call', 'call_third_party', 'get_calls', 'get_transcript']) {
      assert.ok(names.includes(expected), `tool ${expected} missing from list`);
    }
  });

  it('returns credentials_missing in degraded mode for make_call', async () => {
    const res = await send({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'make_call', arguments: { to: '+15551234567', system_prompt: 'hi' } },
    }) as { result: { content: { type: string; text: string }[]; isError?: boolean } };
    const text = res.result.content[0].text;
    const parsed = JSON.parse(text);
    assert.equal(parsed.error, 'credentials_missing');
    assert.match(parsed.action, /setup/);
  });
});
