import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cc-doctor-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface DoctorResult { code: number; out: string; }

function runDoctor(env: Record<string, string>): DoctorResult {
  try {
    const out = execFileSync('node', ['dist/index.js', '--doctor'], {
      env: { ...process.env, ...env }, encoding: 'utf8', cwd: process.cwd(),
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status: number; stdout?: string; stderr?: string };
    return { code: e.status, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

describe('doctor', () => {
  it('exits 1 when credentials are missing', () => {
    const credPath = join(dir, 'no-credentials');
    const res = runDoctor({ CLAUDE_CALL_CREDENTIALS: credPath });
    assert.equal(res.code, 1);
    assert.match(res.out, /credentials/i);
  });

  it('exits 1 with parse error when credentials malformed', () => {
    const credPath = join(dir, 'credentials');
    writeFileSync(credPath, 'NOT_A_VALID_LINE\n', 'utf8');
    chmodSync(credPath, 0o600);
    const res = runDoctor({ CLAUDE_CALL_CREDENTIALS: credPath });
    assert.equal(res.code, 1);
  });
});
