# claude-call v0.2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v0.1 dependency on a separate `patter-mcp` repo with a self-contained plugin that ships its own MCP server (Node + TypeScript, importing the `getpatter` SDK from npm), a marketplace manifest, and a `/claude-call:setup` wizard — reducing install to three commands.

**Architecture:** A new `server/` sub-package inside the plugin compiles to `server/dist/` (committed). Claude Code spawns it over stdio via `.mcp.json`. The server reads credentials from `~/.claude-call/credentials` (mode 0600) at startup, instantiates `Patter` from `getpatter`, exposes 4 MCP tools (`make_call`, `call_third_party`, `get_calls`, `get_transcript`), persists call history to `~/.claude-call/calls.ndjson`, and lazily manages a Cloudflare Quick Tunnel for Twilio webhooks. A `SessionStart` hook prints a one-line reminder when credentials are missing, and `/claude-call:setup` walks the user through configuration.

**Tech Stack:** Node 20+, TypeScript 5, ESM, `@modelcontextprotocol/sdk@^1.29`, `getpatter@^0.5.4`, `tsc` (build), `node:test` + `node:assert/strict` (tests, no third-party runner — esbuild's native binary fails on macOS 26 / Apple Silicon, so we avoid all esbuild-dependent tooling), `cloudflared` (optional, transitive via getpatter).

**Spec:** [`docs/superpowers/specs/2026-04-28-claude-call-smooth-setup-design.md`](../specs/2026-04-28-claude-call-smooth-setup-design.md)

**Repo path note:** All paths in this plan are relative to the plugin root: `/Users/francescorosciano/docs/patter/[FrancescoRosciano]-claude-call`. The brackets are literal directory characters — quote them in shell (`cd "$REPO"`) or use `\[` `\]` escapes.

---

## File Structure

### New files

**Server sub-package (`server/`):**
- `server/package.json` — npm manifest, deps, scripts
- `server/tsconfig.json` — base TypeScript config (strict, ESM)
- `server/tsconfig.build.json` — production build (only `src/`)
- `server/tsconfig.test.json` — test build (`src/` + `tests/` → `.test-build/`)
- `server/.gitignore` — `node_modules/`, `.test-build/`, but **not** `dist/` (committed)
- `server/src/redact.ts` — phone number redaction (port from v0.1 `cc_redact_phone`)
- `server/src/log.ts` — append-only NDJSON logger with auto-redaction
- `server/src/credentials.ts` — parse + validate `~/.claude-call/credentials`
- `server/src/store.ts` — append/read `~/.claude-call/calls.ndjson`
- `server/src/errors.ts` — typed error classes for MCP tool layer
- `server/src/patter.ts` — `Patter` instance factory + tunnel lifecycle
- `server/src/tools/make_call.ts`
- `server/src/tools/call_third_party.ts`
- `server/src/tools/get_calls.ts`
- `server/src/tools/get_transcript.ts`
- `server/src/server.ts` — MCP server, registers tools, handles degraded mode
- `server/src/inbound.ts` — flag-file poller + `Patter.serve()` lifecycle
- `server/src/doctor.ts` — `--doctor` validation command
- `server/src/index.ts` — entrypoint (decides MCP vs doctor mode)
- `server/tests/unit/redact.test.ts`
- `server/tests/unit/log.test.ts`
- `server/tests/unit/credentials.test.ts`
- `server/tests/unit/store.test.ts`
- `server/tests/unit/tools.test.ts`
- `server/tests/integration/mcp.test.ts`
- `server/tests/integration/doctor.test.ts`

**Plugin layer:**
- `.claude-plugin/marketplace.json`
- `commands/setup.md`
- `commands/serve-me.md`
- `commands/serve-me-cancel.md`
- `scripts/on-session-start.sh`
- `tests/unit/on-session-start.bats`

### Modified files

- `.claude-plugin/plugin.json` — bump `version` to `0.2.0`
- `.mcp.json` — replace HTTP url with stdio command/args
- `hooks/hooks.json` — add `SessionStart` entry
- `agents/phone-agent.md` — rename MCP tool prefix `mcp__patter-mcp__` → `mcp__claude-call__`
- `README.md` — new install + quickstart sections, drop `patter-mcp` references
- `CHANGELOG.md` — document v0.2.0 breaking changes
- `Makefile` — add `server-build`, `server-test` targets
- `.github/workflows/ci.yml` — add Node setup + server build/test job

---

## Type Reference (used across multiple tasks)

These types/interfaces are defined in early tasks and referenced later. Listed here for cross-task consistency.

```ts
// server/src/credentials.ts
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

// server/src/store.ts
export interface Turn { role: 'agent' | 'user'; text: string; ts: string; }

export interface CallRecord {
  call_id: string;
  to: string;
  status: 'completed' | 'no-answer' | 'busy' | 'failed' | 'canceled' | 'in-progress';
  started_at: string;
  ended_at?: string;
  duration_seconds?: number;
  cost_usd?: number;
  transcript?: Turn[];
  outcome?: 'success' | 'failure' | 'unclear';
  summary?: string;
  structured?: Record<string, unknown>;
}

// server/src/errors.ts
export type ToolErrorCode =
  | 'credentials_missing'
  | 'credentials_invalid'
  | 'twilio_auth_failed'
  | 'tunnel_failed'
  | 'invalid_input'
  | 'not_found'
  | 'internal';

export interface ToolErrorPayload {
  error: ToolErrorCode;
  message: string;
  action?: string;
  details?: unknown;
}
```

---

## Phase A — Server scaffolding

### Task A1: Create `server/` sub-package

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/tsconfig.build.json`
- Create: `server/tsconfig.test.json`
- Create: `server/.gitignore`
- Create: `server/src/index.ts` (placeholder)
- Create: `server/tests/.gitkeep`

**Toolchain note:** This plan uses `tsc` for builds and Node's built-in `node:test` runner for tests, deliberately avoiding `tsup`/`vitest` because their transitive `esbuild` native binary is killed by the macOS 26 kernel on this developer's machine (see implementation history). Both tools are zero-dep alternatives that ship with Node 20+.

- [ ] **Step 1: Write `server/package.json`**

```json
{
  "name": "@claude-call/server",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "description": "Bundled MCP + voice server for the claude-call plugin",
  "license": "MIT",
  "engines": { "node": ">=20" },
  "main": "dist/index.js",
  "bin": { "claude-call-server": "dist/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "tsc -p tsconfig.test.json && node --test .test-build/tests/**/*.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "getpatter": "^0.5.4"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Write `server/tsconfig.json` (base, no I/O paths)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "lib": ["ES2022"],
    "types": ["node"]
  }
}
```

- [ ] **Step 3: Write `server/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Write `server/tsconfig.test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": ".test-build",
    "rootDir": "."
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 5: Write `server/.gitignore`**

```gitignore
node_modules/
*.log
.env
coverage/
.test-build/
# dist/ is intentionally NOT ignored — it ships with the plugin
```

- [ ] **Step 6: Write placeholder `server/src/index.ts`**

```ts
#!/usr/bin/env node
// Entrypoint — replaced in Task E1.
console.error('claude-call server: entrypoint not yet implemented');
process.exit(1);
```

Also create an empty placeholder so the tests directory exists:
```bash
mkdir -p "$REPO/server/tests" && touch "$REPO/server/tests/.gitkeep"
```

- [ ] **Step 7: Install deps and verify build pipeline**

```bash
REPO="/Users/francescorosciano/docs/patter/[FrancescoRosciano]-claude-call"
cd "$REPO/server" && npm install
```
Expected: installs without warnings other than peer-dep notices. Should NOT pull in esbuild (verify with `ls node_modules/esbuild` → "No such file or directory").

```bash
cd "$REPO/server" && npm run build
```
Expected: `dist/index.js` produced; no errors.

```bash
cd "$REPO/server" && npm test
```
Expected: `tsc` produces `.test-build/`, then `node --test` reports no tests found and exits 0 (Node prints `# pass 0` / `# tests 0`).

- [ ] **Step 8: Commit**

```bash
REPO="/Users/francescorosciano/docs/patter/[FrancescoRosciano]-claude-call"
cd "$REPO" && git add server/ && git -c commit.gpgsign=false commit -m "feat(server): scaffold TypeScript MCP server sub-package"
```

---

### Task A2: Wire build into root `Makefile`

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Read existing `Makefile`**

```bash
cat "$REPO/Makefile"
```

- [ ] **Step 2: Replace `Makefile` with extended version**

```makefile
.PHONY: install-dev test lint server-install server-build server-test ci clean

install-dev:
	@command -v bats >/dev/null 2>&1 || { echo "bats not found — install bats-core"; exit 1; }
	@command -v jq >/dev/null 2>&1 || { echo "jq not found"; exit 1; }
	@command -v node >/dev/null 2>&1 || { echo "node not found"; exit 1; }
	@command -v shellcheck >/dev/null 2>&1 || echo "(optional) shellcheck not found"

server-install:
	cd server && npm ci

server-build:
	cd server && npm run build

server-test:
	cd server && npm test

test:
	bats tests/unit tests/integration

lint:
	-shellcheck scripts/*.sh

ci: install-dev server-install server-build server-test test
	@echo "All CI checks passed."

clean:
	rm -rf server/dist server/node_modules server/coverage
```

- [ ] **Step 3: Verify**

```bash
cd "$REPO" && make server-build
```
Expected: `dist/index.js` rebuilt.

- [ ] **Step 4: Commit**

```bash
cd "$REPO" && git add Makefile && git commit -m "build: add server-install/server-build/server-test targets"
```

---

## Phase B — Server library utilities

### Task B1: `redact.ts` — phone number redaction

**Files:**
- Create: `server/src/redact.ts`
- Test: `server/tests/unit/redact.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/tests/unit/redact.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactPhone } from '../../src/redact.js';

describe('redactPhone', () => {
  it('keeps +<2-digit-country-code> prefix and last-4, masks middle', () => {
    assert.equal(redactPhone('+393331234567'), '+39******4567');
    assert.equal(redactPhone('+15551234567'), '+15*****4567');
  });

  it('returns empty string for empty input', () => {
    assert.equal(redactPhone(''), '');
  });

  it('returns input unchanged when ≤ 4 chars', () => {
    assert.equal(redactPhone('123'), '123');
    assert.equal(redactPhone('1234'), '1234');
  });

  it('preserves leading + and digits in the first 3 positions', () => {
    assert.match(redactPhone('+44 7700 900123'), /^\+44.*0123$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$REPO/server" && npm test
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/redact.ts
export function redactPhone(phone: string): string {
  if (!phone) return '';
  if (phone.length <= 4) return phone;
  const last4 = phone.slice(-4);
  const prefix = phone.slice(0, -4);
  let out = '';
  for (let i = 0; i < prefix.length; i++) {
    const ch = prefix[i];
    if (ch === '+' || /[0-9]/.test(ch)) {
      out += i <= 2 ? ch : '*';
    } else {
      out += ch;
    }
  }
  return out + last4;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$REPO/server" && npm test
```
Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add server/src/redact.ts server/tests/unit/redact.test.ts && git commit -m "feat(server): redactPhone utility (port from v0.1 lib.sh)"
```

---

### Task B2: `log.ts` — append-only NDJSON logger with auto-redaction

**Files:**
- Create: `server/src/log.ts`
- Test: `server/tests/unit/log.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/tests/unit/log.test.ts
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
    await logEvent({ event: 'call', to: '+393331234567', from: '+15551234567' }, logPath);
    const line = readFileSync(logPath, 'utf8').trim();
    const parsed = JSON.parse(line);
    assert.equal(parsed.to, '+39******4567');
    assert.equal(parsed.from, '+15*****4567');
  });

  it('appends multiple lines preserving order', async () => {
    await logEvent({ event: 'a' }, logPath);
    await logEvent({ event: 'b' }, logPath);
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    assert.equal((lines).length, 2);
    assert.equal(JSON.parse(lines[0]).event, 'a');
    assert.equal(JSON.parse(lines[1]).event, 'b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$REPO/server" && npm test
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// server/src/log.ts
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { redactPhone } from './redact.js';

const PHONE_FIELDS = new Set(['to', 'from', 'phone', 'number', 'callee', 'caller']);

export interface LogEntry {
  event: string;
  [key: string]: unknown;
}

function defaultLogPath(): string {
  return process.env.CLAUDE_CALL_LOG ?? join(homedir(), '.claude-call', 'log.ndjson');
}

function redactEntry(entry: LogEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) {
    if (PHONE_FIELDS.has(k) && typeof v === 'string') {
      out[k] = redactPhone(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function logEvent(entry: LogEntry, path?: string): Promise<void> {
  const target = path ?? defaultLogPath();
  await mkdir(dirname(target), { recursive: true });
  const line = JSON.stringify({ ...redactEntry(entry), ts: new Date().toISOString() });
  await appendFile(target, line + '\n', 'utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$REPO/server" && npm test
```
Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add server/src/log.ts server/tests/unit/log.test.ts && git commit -m "feat(server): NDJSON logger with auto-redacted phone fields"
```

---

### Task B3: `credentials.ts` — parse + validate credentials file

**Files:**
- Create: `server/src/credentials.ts`
- Test: `server/tests/unit/credentials.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/tests/unit/credentials.test.ts
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
    await assert.rejects(loadCredentials(credPath), (e) => e.code === 'credentials_missing');
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
    await assert.rejects(loadCredentials(credPath), (e) => e.code === 'credentials_invalid');
  });

  it('refuses world-readable credentials file', async () => {
    writeFileSync(credPath, MIN_CREDS, 'utf8');
    chmodSync(credPath, 0o644);
    await assert.rejects(loadCredentials(credPath), (e) => e.code === 'credentials_invalid');
  });

  it('requires VOICE_ENGINE-specific key (elevenlabs_convai needs ELEVENLABS_*)', async () => {
    const content = MIN_CREDS
      .replace('VOICE_ENGINE=openai_realtime', 'VOICE_ENGINE=elevenlabs_convai')
      .replace('OPENAI_API_KEY=sk-test', '');
    writeFileSync(credPath, content, 'utf8');
    chmodSync(credPath, 0o600);
    await assert.rejects(loadCredentials(credPath), (e) => e.code === 'credentials_invalid');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$REPO/server" && npm test
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// server/src/credentials.ts
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
  // Refuse world- or group-readable files
  const mode = info.mode & 0o077;
  if (mode !== 0) {
    throw new CredentialsError('credentials_invalid', `Credentials file ${target} has overly permissive mode. Run: chmod 0600 ${target}`);
  }
  const content = await readFile(target, 'utf8');
  const parsed = parseCredentials(content);
  return validate(parsed);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$REPO/server" && npm test
```
Expected: 9/9 pass.

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add server/src/credentials.ts server/tests/unit/credentials.test.ts && git commit -m "feat(server): credentials parser with engine-specific validation"
```

---

### Task B4: `store.ts` — calls.ndjson append/read

**Files:**
- Create: `server/src/store.ts`
- Test: `server/tests/unit/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/tests/unit/store.test.ts
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
    assert.equal((calls).length, 1);
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
    assert.equal((calls).length, 2);
  });

  it('listCalls filters by since', async () => {
    await appendCall({ ...REC, call_id: 'CA1', started_at: '2026-04-28T09:00:00Z' }, path);
    await appendCall({ ...REC, call_id: 'CA2', started_at: '2026-04-28T10:00:00Z' }, path);
    const calls = await listCalls({ since: '2026-04-28T09:30:00Z' }, path);
    assert.equal((calls).length, 1);
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$REPO/server" && npm test
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// server/src/store.ts
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface Turn { role: 'agent' | 'user'; text: string; ts: string; }

export interface CallRecord {
  call_id: string;
  to: string;
  status: 'completed' | 'no-answer' | 'busy' | 'failed' | 'canceled' | 'in-progress';
  started_at: string;
  ended_at?: string;
  duration_seconds?: number;
  cost_usd?: number;
  transcript?: Turn[];
  outcome?: 'success' | 'failure' | 'unclear';
  summary?: string;
  structured?: Record<string, unknown>;
}

export interface ListOptions {
  limit?: number;
  since?: string;
}

export function defaultStorePath(): string {
  return process.env.CLAUDE_CALL_STORE ?? join(homedir(), '.claude-call', 'calls.ndjson');
}

export async function appendCall(rec: CallRecord, path?: string): Promise<void> {
  const target = path ?? defaultStorePath();
  await mkdir(dirname(target), { recursive: true });
  await appendFile(target, JSON.stringify(rec) + '\n', 'utf8');
}

async function readAll(path: string): Promise<CallRecord[]> {
  if (!existsSync(path)) return [];
  const content = await readFile(path, 'utf8');
  const out: CallRecord[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as CallRecord);
    } catch {
      // Skip malformed lines silently — store is forward-compatible.
    }
  }
  return out;
}

export async function listCalls(opts: ListOptions = {}, path?: string): Promise<CallRecord[]> {
  const all = await readAll(path ?? defaultStorePath());
  let filtered = all;
  if (opts.since) {
    filtered = filtered.filter((r) => r.started_at >= opts.since!);
  }
  filtered.sort((a, b) => (b.started_at > a.started_at ? 1 : -1));
  if (opts.limit !== undefined) filtered = filtered.slice(0, opts.limit);
  return filtered;
}

export async function getCall(callId: string, path?: string): Promise<CallRecord | null> {
  const all = await readAll(path ?? defaultStorePath());
  return all.find((r) => r.call_id === callId) ?? null;
}

export async function updateCall(callId: string, patch: Partial<CallRecord>, path?: string): Promise<void> {
  const target = path ?? defaultStorePath();
  const all = await readAll(target);
  const existing = all.find((r) => r.call_id === callId);
  const merged: CallRecord = existing ? { ...existing, ...patch } : ({ call_id: callId, ...patch } as CallRecord);
  await appendCall(merged, target);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$REPO/server" && npm test
```
Expected: 7/7 pass.

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add server/src/store.ts server/tests/unit/store.test.ts && git commit -m "feat(server): NDJSON call record store with append/list/get/update"
```

---

### Task B5: `errors.ts` — typed error classes

**Files:**
- Create: `server/src/errors.ts`

- [ ] **Step 1: Write the file**

```ts
// server/src/errors.ts
export type ToolErrorCode =
  | 'credentials_missing'
  | 'credentials_invalid'
  | 'twilio_auth_failed'
  | 'tunnel_failed'
  | 'invalid_input'
  | 'not_found'
  | 'internal';

export interface ToolErrorPayload {
  error: ToolErrorCode;
  message: string;
  action?: string;
  details?: unknown;
}

export class ToolError extends Error {
  constructor(public code: ToolErrorCode, message: string, public action?: string, public details?: unknown) {
    super(message);
    this.name = 'ToolError';
  }

  toPayload(): ToolErrorPayload {
    return { error: this.code, message: this.message, action: this.action, details: this.details };
  }
}

export function asToolError(err: unknown): ToolError {
  if (err instanceof ToolError) return err;
  if (err instanceof Error) {
    if (err.name === 'CredentialsError') {
      const code = (err as Error & { code?: string }).code === 'credentials_missing'
        ? 'credentials_missing' : 'credentials_invalid';
      const action = code === 'credentials_missing' ? 'Run /claude-call:setup' : undefined;
      return new ToolError(code, err.message, action);
    }
    if (err.name === 'AuthenticationError') {
      return new ToolError('twilio_auth_failed', err.message);
    }
    return new ToolError('internal', err.message, undefined, { stack: err.stack });
  }
  return new ToolError('internal', String(err));
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
cd "$REPO/server" && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd "$REPO" && git add server/src/errors.ts && git commit -m "feat(server): typed ToolError + payload schema"
```

---

## Phase C — Patter wrapper

### Task C1: `patter.ts` — Patter instance factory

**Files:**
- Create: `server/src/patter.ts`

- [ ] **Step 1: Write the file**

```ts
// server/src/patter.ts
import { Patter } from 'getpatter';
import { Carrier as TwilioCarrier } from 'getpatter/carriers/twilio';
import { Realtime as OpenAIRealtime } from 'getpatter/engines/openai';
import { ConvAI as ElevenLabsConvAI } from 'getpatter/engines/elevenlabs';
import { CloudflareTunnel } from 'getpatter/tunnels';
import type { Credentials, VoiceEngine } from './credentials.js';
import { logEvent } from './log.js';

export interface PatterContext {
  patter: Patter;
  engine: VoiceEngine;
  phoneNumber: string;
  // Engine instance is reused across .agent() calls
  engineInstance: OpenAIRealtime | ElevenLabsConvAI | undefined;
  credentials: Credentials;
}

let cached: PatterContext | undefined;

export function buildPatter(creds: Credentials): PatterContext {
  if (cached && cached.credentials === creds) return cached;
  const carrier = new TwilioCarrier({ accountSid: creds.TWILIO_ACCOUNT_SID, authToken: creds.TWILIO_AUTH_TOKEN });
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
```

- [ ] **Step 2: Verify typecheck**

```bash
cd "$REPO/server" && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd "$REPO" && git add server/src/patter.ts && git commit -m "feat(server): Patter instance factory with engine selection"
```

---

## Phase D — MCP tools

Tasks D1–D4 implement the four MCP tools. Each tool is a pure async function that accepts validated input and returns a serializable payload (or throws `ToolError`). Tool registration with the MCP SDK happens in Task D5.

### Task D1: `tools/make_call.ts`

**Files:**
- Create: `server/src/tools/make_call.ts`
- Test: `server/tests/unit/tools.test.ts` (start)

- [ ] **Step 1: Write the failing test**

```ts
// server/tests/unit/tools.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateMakeCallInput } from '../../src/tools/make_call.js';

describe('validateMakeCallInput', () => {
  it('rejects non-E.164 numbers', () => {
    assert.throws(() => validateMakeCallInput({ to: '5551234567', system_prompt: 'hi' }), /E\.164/);
  });

  it('rejects missing system_prompt', () => {
    assert.throws(() => validateMakeCallInput({ to: '+15551234567' } as never), /system_prompt/);
  });

  it('rejects oversize system_prompt', () => {
    const big = 'x'.repeat(8001);
    assert.throws(() => validateMakeCallInput({ to: '+15551234567', system_prompt: big }), /8000/);
  });

  it('accepts valid input', () => {
    const v = validateMakeCallInput({ to: '+15551234567', system_prompt: 'Be helpful.', first_message: 'Hi' });
    assert.equal(v.to, '+15551234567');
    assert.equal(v.first_message, 'Hi');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$REPO/server" && npm test
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// server/src/tools/make_call.ts
import { randomUUID } from 'node:crypto';
import { ToolError } from '../errors.js';
import type { PatterContext } from '../patter.js';
import { appendCall, type CallRecord } from '../store.js';
import { logEvent } from '../log.js';

const E164 = /^\+[1-9]\d{1,14}$/;
const SYSTEM_PROMPT_MAX = 8000;
const AI_DISCLOSURE = 'Identify yourself on the first turn as "an AI assistant calling on behalf of Francesco". If asked whether you are human, answer truthfully.';

export interface MakeCallInput {
  to: string;
  system_prompt: string;
  first_message?: string;
  recording?: boolean;
  voicemail_message?: string;
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
  };
}

export async function makeCall(ctx: PatterContext, raw: Partial<MakeCallInput>): Promise<MakeCallOutput> {
  const input = validateMakeCallInput(raw);
  const callId = randomUUID();
  const startedAt = new Date().toISOString();
  const transcript: MakeCallOutput['transcript'] = [];

  const systemPrompt = `${input.system_prompt}\n\n[Hard rule] ${AI_DISCLOSURE}`;
  void logEvent({ event: 'call_dispatch', call_id: callId, to: input.to });

  await appendCall(
    { call_id: callId, to: input.to, status: 'in-progress', started_at: startedAt },
  );

  try {
    await ctx.patter.call({
      to: input.to,
      agent: {
        systemPrompt,
        firstMessage: input.first_message,
        ...(ctx.engineInstance ? { engine: ctx.engineInstance } : {}),
      },
      voicemailMessage: input.voicemail_message,
    } as never);
  } catch (err) {
    void logEvent({ event: 'call_failed', call_id: callId, to: input.to, error: String(err) });
    await appendCall({
      call_id: callId,
      to: input.to,
      status: 'failed',
      started_at: startedAt,
      ended_at: new Date().toISOString(),
    });
    throw err;
  }

  // Drain MetricsStore for the just-completed call
  const store = ctx.patter.metricsStore;
  const record = store?.getCall(callId);
  const endedAt = new Date().toISOString();
  const duration = record?.duration_seconds ? Number(record.duration_seconds) : 0;
  const status = (record?.status as CallRecord['status']) ?? 'completed';
  const cost = typeof record?.cost_usd === 'number' ? record.cost_usd : undefined;

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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$REPO/server" && npm test
```
Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add server/src/tools/make_call.ts server/tests/unit/tools.test.ts && git commit -m "feat(server): make_call tool with validation, AI disclosure, store integration"
```

---

### Task D2: `tools/call_third_party.ts` (with `report_outcome` tool)

**Files:**
- Create: `server/src/tools/call_third_party.ts`
- Modify: `server/tests/unit/tools.test.ts` (append)

- [ ] **Step 1: Append failing tests**

Add to `server/tests/unit/tools.test.ts`:

```ts
import { validateCallThirdPartyInput } from '../../src/tools/call_third_party.js';

describe('validateCallThirdPartyInput', () => {
  it('rejects empty objective', () => {
    assert.throws(() => validateCallThirdPartyInput({ to: '+15551234567', objective: '' }), /objective/);
  });

  it('rejects oversize objective', () => {
    assert.throws(() => validateCallThirdPartyInput({ to: '+15551234567', objective: 'x'.repeat(2001) }), /2000/);
  });

  it('clamps max_turns to [1, 30]', () => {
    assert.equal(validateCallThirdPartyInput({ to: '+15551234567', objective: 'book', max_turns: 100 }).max_turns, 30);
    assert.equal(validateCallThirdPartyInput({ to: '+15551234567', objective: 'book', max_turns: 0 }).max_turns, 1);
  });

  it('accepts valid input with default max_turns=10', () => {
    const v = validateCallThirdPartyInput({ to: '+15551234567', objective: 'Book a table' });
    assert.equal(v.max_turns, 10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$REPO/server" && npm test
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// server/src/tools/call_third_party.ts
import { Tool } from 'getpatter';
import { ToolError } from '../errors.js';
import type { PatterContext } from '../patter.js';
import { makeCall, type MakeCallOutput } from './make_call.js';
import { logEvent } from '../log.js';

const E164 = /^\+[1-9]\d{1,14}$/;
const OBJECTIVE_MAX = 2000;

export interface CallThirdPartyInput {
  to: string;
  objective: string;
  max_turns?: number;
}

export interface CallThirdPartyInputValidated {
  to: string;
  objective: string;
  max_turns: number;
}

export interface CallThirdPartyOutput extends MakeCallOutput {
  outcome: 'success' | 'failure' | 'unclear';
  summary: string;
  structured: Record<string, unknown> | null;
}

export function validateCallThirdPartyInput(input: Partial<CallThirdPartyInput>): CallThirdPartyInputValidated {
  if (!input.to || !E164.test(input.to)) {
    throw new ToolError('invalid_input', 'to must be E.164 (e.g. +15551234567)');
  }
  if (!input.objective || input.objective.trim().length === 0) {
    throw new ToolError('invalid_input', 'objective is required');
  }
  if (input.objective.length > OBJECTIVE_MAX) {
    throw new ToolError('invalid_input', `objective exceeds ${OBJECTIVE_MAX} chars`);
  }
  const requested = input.max_turns ?? 10;
  const max_turns = Math.max(1, Math.min(30, requested));
  return { to: input.to, objective: input.objective.trim(), max_turns };
}

const SYSTEM_TEMPLATE = (objective: string, maxTurns: number) => `You are an AI assistant making a phone call to pursue a single objective.

OBJECTIVE: ${objective}

You have at most ${maxTurns} turns. Be polite, concise, and stay on objective.

When the call is about to end, call the report_outcome tool exactly once with:
- outcome: "success" if the objective was achieved, "failure" if it was not, "unclear" if the situation is ambiguous.
- summary: 1-2 sentences describing what happened.
- structured: an object with the key facts (e.g. {time: "20:00", confirmation: "ABC123"}). Use {} if none.

Do NOT speak the JSON; the tool call is silent. After calling report_outcome, say goodbye and end the call.`;

export async function callThirdParty(ctx: PatterContext, raw: Partial<CallThirdPartyInput>): Promise<CallThirdPartyOutput> {
  const input = validateCallThirdPartyInput(raw);

  let outcome: CallThirdPartyOutput['outcome'] = 'unclear';
  let summary = 'Call ended without structured outcome';
  let structured: Record<string, unknown> | null = null;

  const reportOutcome = new Tool({
    name: 'report_outcome',
    description: 'Report the final outcome of the call. Call exactly once before saying goodbye.',
    parameters: {
      type: 'object',
      properties: {
        outcome: { type: 'string', enum: ['success', 'failure', 'unclear'] },
        summary: { type: 'string' },
        structured: { type: 'object' },
      },
      required: ['outcome', 'summary'],
    },
    handler: async (args: Record<string, unknown>) => {
      outcome = (args.outcome as typeof outcome) ?? 'unclear';
      summary = String(args.summary ?? summary);
      structured = (args.structured as Record<string, unknown> | undefined) ?? null;
      void logEvent({ event: 'outcome_reported', outcome, summary });
      return 'Outcome recorded.';
    },
  } as never);

  // Patch the make_call invocation with our tool + system prompt template
  const result = await makeCall(ctx, {
    to: input.to,
    system_prompt: SYSTEM_TEMPLATE(input.objective, input.max_turns),
    first_message: undefined,
  });

  // Tool wiring: the Patter agent options accept a tools array. We hand it through
  // make_call by attaching a side-channel via patter context — but make_call doesn't
  // currently forward tools. So we re-implement the call here with the same shape:
  void reportOutcome; // referenced for type-checker (wired by future iteration if forward path lands)

  return { ...result, outcome, summary, structured };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$REPO/server" && npm test
```
Expected: all input-validation tests pass.

- [ ] **Step 5: Refactor `make_call` to accept tools, then re-wire `call_third_party`**

Modify `server/src/tools/make_call.ts` to accept an optional `tools` array, and re-wire `call_third_party` to pass `[reportOutcome]`:

In `server/src/tools/make_call.ts`, change the `MakeCallInput` interface and the `agent: { ... }` block:

```ts
import type { Tool } from 'getpatter';

export interface MakeCallInput {
  to: string;
  system_prompt: string;
  first_message?: string;
  recording?: boolean;
  voicemail_message?: string;
  tools?: Tool[];  // NEW
}

// In makeCall(), update the .call() invocation:
await ctx.patter.call({
  to: input.to,
  agent: {
    systemPrompt,
    firstMessage: input.first_message,
    tools: input.tools,
    ...(ctx.engineInstance ? { engine: ctx.engineInstance } : {}),
  },
  voicemailMessage: input.voicemail_message,
} as never);
```

In `server/src/tools/call_third_party.ts`, replace the `void reportOutcome` line with:

```ts
const result = await makeCall(ctx, {
  to: input.to,
  system_prompt: SYSTEM_TEMPLATE(input.objective, input.max_turns),
  first_message: undefined,
  tools: [reportOutcome],
});
```

(Remove the earlier duplicate `await makeCall(...)` call.)

- [ ] **Step 6: Re-run tests**

```bash
cd "$REPO/server" && npm test
```
Expected: 8/8 pass.

- [ ] **Step 7: Commit**

```bash
cd "$REPO" && git add server/src/tools/make_call.ts server/src/tools/call_third_party.ts server/tests/unit/tools.test.ts && git commit -m "feat(server): call_third_party with report_outcome side-channel"
```

---

### Task D3: `tools/get_calls.ts`

**Files:**
- Create: `server/src/tools/get_calls.ts`
- Modify: `server/tests/unit/tools.test.ts` (append)

- [ ] **Step 1: Append failing test**

```ts
import { validateGetCallsInput } from '../../src/tools/get_calls.js';

describe('validateGetCallsInput', () => {
  it('defaults limit to 20', () => {
    assert.equal(validateGetCallsInput({}).limit, 20);
  });

  it('clamps limit to [1, 200]', () => {
    assert.equal(validateGetCallsInput({ limit: 1000 }).limit, 200);
    assert.equal(validateGetCallsInput({ limit: 0 }).limit, 1);
  });

  it('rejects malformed since timestamp', () => {
    assert.throws(() => validateGetCallsInput({ since: 'yesterday' }), /ISO8601/);
  });

  it('accepts valid since timestamp', () => {
    const v = validateGetCallsInput({ since: '2026-04-28T10:00:00Z' });
    assert.equal(v.since, '2026-04-28T10:00:00Z');
  });
});
```

- [ ] **Step 2: Write implementation**

```ts
// server/src/tools/get_calls.ts
import { ToolError } from '../errors.js';
import { listCalls, type CallRecord } from '../store.js';

const ISO8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export interface GetCallsInput {
  limit?: number;
  since?: string;
}

export interface GetCallsValidated {
  limit: number;
  since?: string;
}

export interface GetCallsOutput {
  calls: CallRecord[];
}

export function validateGetCallsInput(input: Partial<GetCallsInput>): GetCallsValidated {
  const limit = Math.max(1, Math.min(200, input.limit ?? 20));
  if (input.since !== undefined && !ISO8601.test(input.since)) {
    throw new ToolError('invalid_input', 'since must be ISO8601 (e.g. 2026-04-28T10:00:00Z)');
  }
  return { limit, since: input.since };
}

export async function getCalls(raw: Partial<GetCallsInput>): Promise<GetCallsOutput> {
  const input = validateGetCallsInput(raw);
  const calls = await listCalls(input);
  return { calls };
}
```

- [ ] **Step 3: Run tests**

```bash
cd "$REPO/server" && npm test
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
cd "$REPO" && git add server/src/tools/get_calls.ts server/tests/unit/tools.test.ts && git commit -m "feat(server): get_calls tool with limit clamping + since filter"
```

---

### Task D4: `tools/get_transcript.ts`

**Files:**
- Create: `server/src/tools/get_transcript.ts`
- Modify: `server/tests/unit/tools.test.ts` (append)

- [ ] **Step 1: Append failing test**

```ts
import { validateGetTranscriptInput } from '../../src/tools/get_transcript.js';

describe('validateGetTranscriptInput', () => {
  it('rejects missing call_id', () => {
    assert.throws(() => validateGetTranscriptInput({} as never), /call_id/);
  });

  it('rejects empty call_id', () => {
    assert.throws(() => validateGetTranscriptInput({ call_id: '' }), /call_id/);
  });

  it('accepts non-empty call_id', () => {
    assert.equal(validateGetTranscriptInput({ call_id: 'CA1' }).call_id, 'CA1');
  });
});
```

- [ ] **Step 2: Write implementation**

```ts
// server/src/tools/get_transcript.ts
import { ToolError } from '../errors.js';
import { getCall, type Turn } from '../store.js';

export interface GetTranscriptInput { call_id: string; }
export interface GetTranscriptOutput {
  call_id: string;
  turns: Turn[];
  duration_seconds: number;
}

export function validateGetTranscriptInput(input: Partial<GetTranscriptInput>): GetTranscriptInput {
  if (!input.call_id) throw new ToolError('invalid_input', 'call_id is required');
  return { call_id: input.call_id };
}

export async function getTranscript(raw: Partial<GetTranscriptInput>): Promise<GetTranscriptOutput> {
  const { call_id } = validateGetTranscriptInput(raw);
  const rec = await getCall(call_id);
  if (!rec) throw new ToolError('not_found', `Call ${call_id} not found`);
  return {
    call_id,
    turns: rec.transcript ?? [],
    duration_seconds: rec.duration_seconds ?? 0,
  };
}
```

- [ ] **Step 3: Run tests**

```bash
cd "$REPO/server" && npm test
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
cd "$REPO" && git add server/src/tools/get_transcript.ts server/tests/unit/tools.test.ts && git commit -m "feat(server): get_transcript tool"
```

---

### Task D5: `server.ts` — MCP server registration with degraded mode

**Files:**
- Create: `server/src/server.ts`
- Test: `server/tests/integration/mcp.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// server/tests/integration/mcp.test.ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let proc: ChildProcess;
let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'cc-mcp-'));
  proc = spawn('node', ['dist/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLAUDE_CALL_CREDENTIALS: join(dir, 'no-credentials'),  // missing on purpose
      CLAUDE_CALL_LOG: join(dir, 'log.ndjson'),
      CLAUDE_CALL_STORE: join(dir, 'calls.ndjson'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
});

after(() => {
  proc.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
});

function send(req: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onData = (buf: Buffer) => {
      const lines = buf.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === (req as { id: number }).id) {
            proc.stdout?.off('data', onData);
            resolve(parsed);
            return;
          }
        } catch { /* skip non-JSON */ }
      }
    };
    proc.stdout?.on('data', onData);
    setTimeout(() => reject(new Error('timeout')), 5000);
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
```

- [ ] **Step 2: Write implementation**

```ts
// server/src/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadCredentials, defaultCredentialsPath } from './credentials.js';
import { buildPatter, type PatterContext } from './patter.js';
import { asToolError, ToolError } from './errors.js';
import { logEvent } from './log.js';
import { makeCall, validateMakeCallInput } from './tools/make_call.js';
import { callThirdParty, validateCallThirdPartyInput } from './tools/call_third_party.js';
import { getCalls, validateGetCallsInput } from './tools/get_calls.js';
import { getTranscript, validateGetTranscriptInput } from './tools/get_transcript.js';

interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
  handler: (ctx: PatterContext, args: Record<string, unknown>) => Promise<unknown>;
  // Validators that don't need a Patter context (cheap pre-flight)
  validate: (args: Record<string, unknown>) => void;
}

const TOOLS: ToolDef[] = [
  {
    name: 'make_call',
    description: 'Place an outbound voice call. Returns transcript and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'E.164 phone number, e.g. +15551234567' },
        system_prompt: { type: 'string', description: 'System prompt for the in-call agent' },
        first_message: { type: 'string' },
        recording: { type: 'boolean' },
        voicemail_message: { type: 'string' },
      },
      required: ['to', 'system_prompt'],
    },
    validate: (a) => { validateMakeCallInput(a as never); },
    handler: (ctx, a) => makeCall(ctx, a as never),
  },
  {
    name: 'call_third_party',
    description: 'Call a third party with an objective; returns structured outcome.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        objective: { type: 'string' },
        max_turns: { type: 'number' },
      },
      required: ['to', 'objective'],
    },
    validate: (a) => { validateCallThirdPartyInput(a as never); },
    handler: (ctx, a) => callThirdParty(ctx, a as never),
  },
  {
    name: 'get_calls',
    description: 'List recent calls.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' }, since: { type: 'string' } },
    },
    validate: (a) => { validateGetCallsInput(a as never); },
    handler: (_ctx, a) => getCalls(a as never),
  },
  {
    name: 'get_transcript',
    description: 'Get full transcript of a previous call.',
    inputSchema: {
      type: 'object',
      properties: { call_id: { type: 'string' } },
      required: ['call_id'],
    },
    validate: (a) => { validateGetTranscriptInput(a as never); },
    handler: (_ctx, a) => getTranscript(a as never),
  },
];

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: 'claude-call', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  let ctxPromise: Promise<PatterContext> | undefined;
  async function getCtx(): Promise<PatterContext> {
    if (!ctxPromise) {
      ctxPromise = (async () => {
        const creds = await loadCredentials();
        return buildPatter(creds);
      })();
    }
    return ctxPromise;
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) {
      const err = new ToolError('invalid_input', `Unknown tool: ${req.params.name}`);
      return { content: [{ type: 'text', text: JSON.stringify(err.toPayload()) }], isError: true };
    }
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      // Tools that don't need credentials (get_calls, get_transcript) skip the patter ctx
      const needsPatter = tool.name === 'make_call' || tool.name === 'call_third_party';
      tool.validate(args);
      const ctx = needsPatter ? await getCtx() : (undefined as unknown as PatterContext);
      const result = await tool.handler(ctx, args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      const toolErr = asToolError(err);
      void logEvent({ event: 'tool_error', tool: tool.name, code: toolErr.code, message: toolErr.message });
      return { content: [{ type: 'text', text: JSON.stringify(toolErr.toPayload()) }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  void logEvent({ event: 'mcp_server_started', credentials_path: defaultCredentialsPath() });
}
```

- [ ] **Step 3: Build and run integration test**

```bash
cd "$REPO/server" && npm test
```
Expected: 3/3 pass.

- [ ] **Step 4: Commit**

```bash
cd "$REPO" && git add server/src/server.ts server/tests/integration/mcp.test.ts && git commit -m "feat(server): MCP server with 4 tools and credentials_missing degraded mode"
```

---

## Phase E — Entrypoints

### Task E1: `index.ts` — main entrypoint

**Files:**
- Modify: `server/src/index.ts` (replace placeholder)

- [ ] **Step 1: Write entrypoint**

```ts
#!/usr/bin/env node
// server/src/index.ts
import { startMcpServer } from './server.js';
import { runDoctor } from './doctor.js';
import { logEvent } from './log.js';

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === '--doctor') {
    const code = await runDoctor();
    process.exit(code);
  }
  if (arg === '--version') {
    console.log('0.2.0');
    process.exit(0);
  }
  await startMcpServer();
}

main().catch((err) => {
  void logEvent({ event: 'fatal', error: String(err), stack: err instanceof Error ? err.stack : undefined });
  console.error('claude-call server fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify build still produces dist/index.js**

```bash
cd "$REPO/server" && npm run build
```
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
cd "$REPO" && git add server/src/index.ts && git commit -m "feat(server): entrypoint dispatching MCP / --doctor / --version"
```

---

### Task E2: `doctor.ts` — `--doctor` validation

**Files:**
- Create: `server/src/doctor.ts`
- Test: `server/tests/integration/doctor.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// server/tests/integration/doctor.test.ts
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

function runDoctor(env: Record<string, string>): { code: number; out: string } {
  try {
    const out = execFileSync('node', ['dist/index.js', '--doctor'], {
      env: { ...process.env, ...env }, encoding: 'utf8', cwd: process.cwd(),
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
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
```

- [ ] **Step 2: Write implementation**

```ts
// server/src/doctor.ts
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
    return { name: 'Twilio auth', ok: false, detail: String(err) };
  }
}

async function checkOpenAI(key: string): Promise<Check> {
  try {
    const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    if (res.ok) return { name: 'OpenAI API reachable', ok: true };
    return { name: 'OpenAI API reachable', ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { name: 'OpenAI API reachable', ok: false, detail: String(err) };
  }
}

async function checkElevenLabs(key: string): Promise<Check> {
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': key } });
    if (res.ok) return { name: 'ElevenLabs API reachable', ok: true };
    return { name: 'ElevenLabs API reachable', ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { name: 'ElevenLabs API reachable', ok: false, detail: String(err) };
  }
}

async function checkDeepgram(key: string): Promise<Check> {
  try {
    const res = await fetch('https://api.deepgram.com/v1/projects', { headers: { Authorization: `Token ${key}` } });
    if (res.ok) return { name: 'Deepgram API reachable', ok: true };
    return { name: 'Deepgram API reachable', ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { name: 'Deepgram API reachable', ok: false, detail: String(err) };
  }
}

export async function runDoctor(): Promise<number> {
  console.log('claude-call doctor');
  const checks: Check[] = [];
  try {
    const creds = await loadCredentials();
    checks.push({ name: 'Credentials parsed', ok: true, detail: `engine=${creds.VOICE_ENGINE}, phone=${redactPhone(creds.TWILIO_PHONE_NUMBER)}` });
    checks.push(await checkTwilio(creds.TWILIO_ACCOUNT_SID, creds.TWILIO_AUTH_TOKEN));
    if (creds.OPENAI_API_KEY) checks.push(await checkOpenAI(creds.OPENAI_API_KEY));
    if (creds.ELEVENLABS_API_KEY) checks.push(await checkElevenLabs(creds.ELEVENLABS_API_KEY));
    if (creds.DEEPGRAM_API_KEY) checks.push(await checkDeepgram(creds.DEEPGRAM_API_KEY));
  } catch (err) {
    const e = err as Error;
    checks.push({ name: 'Credentials', ok: false, detail: e.message });
  }

  let allOk = true;
  for (const c of checks) {
    const mark = c.ok ? '✓' : '✗';
    const line = c.detail ? `${mark} ${c.name} (${c.detail})` : `${mark} ${c.name}`;
    console.log(line);
    if (!c.ok) allOk = false;
  }
  console.log(allOk ? 'All checks passed.' : 'One or more checks failed.');
  return allOk ? 0 : 1;
}
```

- [ ] **Step 3: Run tests**

```bash
cd "$REPO/server" && npm test
```
Expected: 2/2 pass.

- [ ] **Step 4: Commit**

```bash
cd "$REPO" && git add server/src/doctor.ts server/tests/integration/doctor.test.ts && git commit -m "feat(server): --doctor mode with Twilio/OpenAI/ElevenLabs/Deepgram health checks"
```

---

### Task E3: `inbound.ts` — `/serve-me` flag-file watcher

**Files:**
- Create: `server/src/inbound.ts`
- Modify: `server/src/server.ts` to start the watcher on boot

- [ ] **Step 1: Write `inbound.ts`**

```ts
// server/src/inbound.ts
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PatterContext } from './patter.js';
import { logEvent } from './log.js';

const POLL_MS = 1000;

function flagPath(): string {
  return process.env.CLAUDE_CALL_INBOUND_FLAG ?? join(homedir(), '.claude-call', 'inbound-armed');
}

function messagesPath(): string {
  return process.env.CLAUDE_CALL_MESSAGES ?? join(homedir(), '.claude-call', 'messages.ndjson');
}

const INBOUND_PROMPT = `You are Claude Code's voice channel for Francesco. Take messages and answer general questions politely. You cannot execute Claude Code commands; if the caller asks for a code action, take the message and tell them you'll relay it. Identify yourself on the first turn as "an AI assistant for Francesco's Claude Code session". If asked whether you are human, answer truthfully.`;

export function startInboundWatcher(getCtx: () => Promise<PatterContext>): void {
  let serving = false;
  setInterval(async () => {
    const armed = existsSync(flagPath());
    if (armed && !serving) {
      try {
        const ctx = await getCtx();
        await ctx.patter.serve({
          agent: { systemPrompt: INBOUND_PROMPT, ...(ctx.engineInstance ? { engine: ctx.engineInstance } : {}) },
          onTranscript: async (data) => {
            const text = String((data as { text?: string }).text ?? '');
            if (text) {
              const { appendFile } = await import('node:fs/promises');
              const line = JSON.stringify({ ts: new Date().toISOString(), text }) + '\n';
              await appendFile(messagesPath(), line, 'utf8');
            }
          },
        } as never);
        serving = true;
        void logEvent({ event: 'inbound_armed' });
      } catch (err) {
        void logEvent({ event: 'inbound_serve_failed', error: String(err) });
      }
    } else if (!armed && serving) {
      try {
        const ctx = await getCtx();
        await ctx.patter.disconnect();
        serving = false;
        void logEvent({ event: 'inbound_disarmed' });
      } catch (err) {
        void logEvent({ event: 'inbound_disconnect_failed', error: String(err) });
      }
    }
  }, POLL_MS);
}

export function isInboundArmed(): boolean {
  return existsSync(flagPath());
}

export function readMessages(): { ts: string; text: string }[] {
  const path = messagesPath();
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
```

- [ ] **Step 2: Wire into `server.ts`**

In `server/src/server.ts`, at the bottom of `startMcpServer`, just before the final `void logEvent({...})`, add:

```ts
import { startInboundWatcher } from './inbound.js';
// ...
startInboundWatcher(getCtx);
```

(Add the import to the top of the file.)

- [ ] **Step 3: Build to verify wiring**

```bash
cd "$REPO/server" && npm run build
```
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
cd "$REPO" && git add server/src/inbound.ts server/src/server.ts && git commit -m "feat(server): inbound flag-file watcher for /serve-me"
```

---

## Phase F — Plugin metadata

### Task F1: `.claude-plugin/marketplace.json`

**Files:**
- Create: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Write file**

```json
{
  "name": "claude-call",
  "owner": {
    "name": "Francesco Rosciano",
    "email": "francesco.rosciano@me.com"
  },
  "description": "Two-way voice bridge for Claude Code — make outbound calls, get rung when work is done.",
  "plugins": [
    {
      "name": "claude-call",
      "source": "./",
      "description": "Two-way voice bridge for Claude Code via Patter",
      "version": "0.2.0",
      "category": "communication",
      "tags": ["voice", "phone", "telephony", "patter"]
    }
  ]
}
```

- [ ] **Step 2: Validate JSON**

```bash
cd "$REPO" && jq . .claude-plugin/marketplace.json > /dev/null && echo OK
```
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
cd "$REPO" && git add .claude-plugin/marketplace.json && git commit -m "feat: marketplace manifest for self-distribution"
```

---

### Task F2: rewrite `.mcp.json` to stdio + bump `plugin.json` version

**Files:**
- Modify: `.mcp.json`
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 1: Replace `.mcp.json`**

```json
{
  "mcpServers": {
    "claude-call": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/server/dist/index.js"],
      "cwd": "${CLAUDE_PLUGIN_ROOT}/server"
    }
  }
}
```

- [ ] **Step 2: Bump `.claude-plugin/plugin.json`**

Change the existing file's `"version": "0.1.0"` to `"version": "0.2.0"`. Leave everything else as-is.

- [ ] **Step 3: Validate JSON**

```bash
cd "$REPO" && jq . .mcp.json .claude-plugin/plugin.json > /dev/null && echo OK
```
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
cd "$REPO" && git add .mcp.json .claude-plugin/plugin.json && git commit -m "feat: switch .mcp.json to bundled stdio server, bump to 0.2.0

BREAKING CHANGE: MCP server name changes from patter-mcp to claude-call.
PATTER_MCP_URL env var is removed. Phone-agent tool prefix updates."
```

---

### Task F3: update `agents/phone-agent.md` MCP tool prefix

**Files:**
- Modify: `agents/phone-agent.md`

- [ ] **Step 1: Replace MCP tool names**

In `agents/phone-agent.md`, replace `mcp__patter-mcp__` with `mcp__claude-call__` (4 occurrences in the `tools:` line).

The frontmatter `tools:` line should read:
```yaml
tools: Bash, mcp__claude-call__call_third_party, mcp__claude-call__make_call, mcp__claude-call__get_calls, mcp__claude-call__get_transcript
```

Also replace the body line `You orchestrate phone calls placed through patter-mcp.` with `You orchestrate phone calls placed through the claude-call MCP server.`

- [ ] **Step 2: Verify**

```bash
cd "$REPO" && ! grep -q 'patter-mcp' agents/phone-agent.md && echo "no patter-mcp references" || echo "STILL HAS REFERENCES"
```
Expected: `no patter-mcp references`.

- [ ] **Step 3: Commit**

```bash
cd "$REPO" && git add agents/phone-agent.md && git commit -m "feat(agent): update phone-agent MCP prefix to mcp__claude-call__"
```

---

## Phase G — Hooks & commands

### Task G1: `scripts/on-session-start.sh`

**Files:**
- Create: `scripts/on-session-start.sh`
- Test: `tests/unit/on-session-start.bats`

- [ ] **Step 1: Write failing bats test**

```bash
#!/usr/bin/env bats
# tests/unit/on-session-start.bats

load '../helpers/setup'

@test "prints reminder when credentials file is missing" {
  export HOME="${CLAUDE_CALL_TMP}"
  rm -f "${HOME}/.claude-call/credentials"
  run "${REPO_ROOT}/scripts/on-session-start.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"/claude-call:setup"* ]]
}

@test "is silent when credentials file exists and is non-empty" {
  export HOME="${CLAUDE_CALL_TMP}"
  mkdir -p "${HOME}/.claude-call"
  echo "TWILIO_ACCOUNT_SID=AC1" > "${HOME}/.claude-call/credentials"
  chmod 0600 "${HOME}/.claude-call/credentials"
  run "${REPO_ROOT}/scripts/on-session-start.sh"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$REPO" && bats tests/unit/on-session-start.bats
```
Expected: FAIL — script not found.

- [ ] **Step 3: Write the hook script**

```bash
#!/usr/bin/env bash
# scripts/on-session-start.sh
# claude-call SessionStart hook — prints first-run reminder if unconfigured.
set -euo pipefail

CRED_PATH="${CLAUDE_CALL_CREDENTIALS:-$HOME/.claude-call/credentials}"

if [ ! -s "$CRED_PATH" ]; then
  echo "claude-call: not yet configured. Run /claude-call:setup to enable phone calls."
fi

exit 0
```

Make it executable:
```bash
chmod +x "$REPO/scripts/on-session-start.sh"
```

- [ ] **Step 4: Run tests**

```bash
cd "$REPO" && bats tests/unit/on-session-start.bats
```
Expected: 2/2 pass.

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add scripts/on-session-start.sh tests/unit/on-session-start.bats && git commit -m "feat(hooks): SessionStart reminder when credentials are missing"
```

---

### Task G2: register `SessionStart` in `hooks/hooks.json`

**Files:**
- Modify: `hooks/hooks.json`

- [ ] **Step 1: Replace `hooks/hooks.json`**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/on-session-start.sh" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/on-stop.sh" }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/on-notification.sh permission_prompt" }
        ]
      },
      {
        "matcher": "idle_prompt",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/on-notification.sh idle_prompt" }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/disarm.sh" }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Validate**

```bash
cd "$REPO" && jq . hooks/hooks.json > /dev/null && echo OK
```
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
cd "$REPO" && git add hooks/hooks.json && git commit -m "feat(hooks): wire SessionStart for first-run reminder"
```

---

### Task G3: `commands/setup.md` — `/claude-call:setup` wizard

**Files:**
- Create: `commands/setup.md`

- [ ] **Step 1: Write the command file**

```markdown
---
description: Configure Twilio + voice engine credentials for claude-call
---

# /claude-call:setup

You are running the claude-call setup wizard. Walk the user through configuring credentials.

## Step 1 — Check existing config

```bash
test -s "$HOME/.claude-call/credentials" && echo EXISTS || echo MISSING
```

If `EXISTS`, ask the user with AskUserQuestion: "Existing credentials found at ~/.claude-call/credentials. Overwrite?" (Yes / No). If No, exit.

## Step 2 — Collect Twilio credentials

Use AskUserQuestion sequentially. **Validate each answer before moving on.** If invalid, re-prompt.

1. **Twilio Account SID** — must match `^AC[0-9a-fA-F]{32}$`
2. **Twilio Auth Token** — non-empty
3. **Twilio Phone Number** — E.164, must match `^\+[1-9]\d{1,14}$`

## Step 3 — Voice engine choice

AskUserQuestion with options:
- `openai_realtime` (default; recommended)
- `elevenlabs_convai`
- `pipeline` (Deepgram STT + ElevenLabs TTS + OpenAI LLM)

## Step 4 — Engine-specific keys

Based on the engine:
- **openai_realtime** → ask for OPENAI_API_KEY (validate non-empty, starts with `sk-`)
- **elevenlabs_convai** → ask for ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID
- **pipeline** → ask for OPENAI_API_KEY, DEEPGRAM_API_KEY, ELEVENLABS_API_KEY

## Step 5 — Write file

```bash
mkdir -m 0700 -p "$HOME/.claude-call"
cat > "$HOME/.claude-call/credentials" << 'EOF'
# claude-call credentials — managed by /claude-call:setup
# Do not commit this file. Re-run /claude-call:setup to update.
TWILIO_ACCOUNT_SID=<sid>
TWILIO_AUTH_TOKEN=<token>
TWILIO_PHONE_NUMBER=<phone>
VOICE_ENGINE=<engine>
# Engine-specific keys go below this line
<engine_keys>
EOF
chmod 0600 "$HOME/.claude-call/credentials"
```

Substitute the captured values in place of the angle-bracket placeholders. Use a heredoc with **single quotes around the EOF marker** so shell substitution does not happen on the heredoc body — replace placeholders in the markdown plan, not via `$VAR` expansion.

## Step 6 — Run doctor

```bash
node "${CLAUDE_PLUGIN_ROOT}/server/dist/index.js" --doctor
```

If exit 0, print:

```
✓ Setup complete. Try: /call +<your-number> say hello
```

If exit non-zero, print the doctor output verbatim and tell the user to re-run /claude-call:setup or fix the failing key in `~/.claude-call/credentials` directly.

## Step 7 — Reload MCP

Tell the user that the bundled MCP server picks up new credentials the next time it starts. Recommend `/exit` and reopen the session, or use `/mcp restart claude-call` if available.

## Hard rules

- NEVER print collected credentials back to the user (echo only the masked Twilio SID prefix).
- NEVER commit, log, or paste any credential value to NDJSON / log files / chat history.
- The credentials file MUST end up at mode 0600.
```

- [ ] **Step 2: Commit**

```bash
cd "$REPO" && git add commands/setup.md && git commit -m "feat(commands): /claude-call:setup wizard"
```

---

### Task G4: `commands/serve-me.md` and `commands/serve-me-cancel.md`

**Files:**
- Create: `commands/serve-me.md`
- Create: `commands/serve-me-cancel.md`

- [ ] **Step 1: Write `commands/serve-me.md`**

```markdown
---
description: Arm the inbound voice agent — calls to your Twilio number reach Claude
---

# /serve-me

Enable inbound voice calls.

## Steps

1. Verify credentials exist:
   ```bash
   test -s "$HOME/.claude-call/credentials" || echo "Run /claude-call:setup first"
   ```
   If missing, abort with that message.

2. Create the flag file:
   ```bash
   mkdir -m 0700 -p "$HOME/.claude-call"
   touch "$HOME/.claude-call/inbound-armed"
   ```

3. Print:
   ```
   ✓ Inbound voice agent armed. Dial your Twilio number to reach Claude.
   Inbound messages are stored at ~/.claude-call/messages.ndjson.
   Run /serve-me-cancel to disarm.
   ```

The bundled MCP server polls this flag every 1 second and starts `Patter.serve()` automatically.
```

- [ ] **Step 2: Write `commands/serve-me-cancel.md`**

```markdown
---
description: Disarm the inbound voice agent
---

# /serve-me-cancel

Disable inbound voice calls.

## Steps

1. Remove the flag:
   ```bash
   rm -f "$HOME/.claude-call/inbound-armed"
   ```

2. Print:
   ```
   ✓ Inbound voice agent disarmed.
   ```

The bundled MCP server detects the missing flag within 1 second and stops `Patter.serve()`.
```

- [ ] **Step 3: Commit**

```bash
cd "$REPO" && git add commands/serve-me.md commands/serve-me-cancel.md && git commit -m "feat(commands): /serve-me and /serve-me-cancel for inbound calls"
```

---

## Phase H — Migration & polish

### Task H1: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace install + quickstart sections**

In `README.md`, replace the `## ✦ Quick install` section's body with:

```markdown
## ✦ Quick install

```
/plugin marketplace add https://github.com/FrancescoRosciano/claude-call
/plugin install claude-call@claude-call
/claude-call:setup
```

> **Prerequisites** — Claude Code 2.0+ · Node 20+ · macOS or Linux · Twilio number + OpenAI API key (or ElevenLabs / Deepgram if you pick a different voice engine).

The `/claude-call:setup` wizard collects credentials, writes them to `~/.claude-call/credentials` (mode 0600), and runs a connectivity check.
```

Remove every reference to `patter-mcp` in the README. Update the prerequisites list. Update the "How it works" architecture diagram to:

```
┌────────────────────────────────┐
│  Claude Code session           │
│  ├─ /call, /notify-me, ...     │  slash commands
│  ├─ phone-agent                │  subagent
│  └─ hooks/                     │  Stop, Notification, SessionStart, SessionEnd
└──────────────┬─────────────────┘
               │ stdio MCP
               ▼
┌────────────────────────────────┐
│  bundled server (server/)      │
│  ├─ make_call · call_third_party
│  ├─ get_calls · get_transcript │
│  └─ Patter SDK + Cloudflare    │
└──────────────┬─────────────────┘
               ▼
        Twilio → PSTN
```

Update the "powered by patter" badge to remain (still accurate). Add a CHANGELOG link to `## ✦ Project docs`.

- [ ] **Step 2: Verify no patter-mcp references remain**

```bash
cd "$REPO" && grep -n 'patter-mcp' README.md && echo "STILL HAS" || echo "CLEAN"
```
Expected: `CLEAN`.

- [ ] **Step 3: Commit**

```bash
cd "$REPO" && git add README.md && git commit -m "docs(readme): rewrite for v0.2.0 — three-command install, no patter-mcp"
```

---

### Task H2: Update `CHANGELOG.md`

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Prepend v0.2.0 section**

Add at the top (above the v0.1.0 entry):

```markdown
## 0.2.0 — 2026-04-28

### Added
- Self-contained bundled MCP server in `server/` (TypeScript, ESM). No more external `patter-mcp` repo dependency.
- Marketplace manifest at `.claude-plugin/marketplace.json` enabling `/plugin marketplace add` install path.
- `/claude-call:setup` slash command — interactive credential wizard.
- `/serve-me` and `/serve-me-cancel` — toggle inbound voice agent.
- `--doctor` CLI mode for non-interactive credential validation.
- `SessionStart` hook prints first-run reminder when unconfigured.

### Changed
- **BREAKING:** MCP server name changes from `patter-mcp` to `claude-call`. Phone-agent tool prefix updated from `mcp__patter-mcp__*` to `mcp__claude-call__*`.
- **BREAKING:** `PATTER_MCP_URL` env var removed. Configuration now lives in `~/.claude-call/credentials` (mode 0600).
- `.mcp.json` switches transport from HTTP to stdio.
- Three-command install replaces "clone two repos + edit .env + npm run dev" flow.

### Removed
- `scripts/preflight.sh` HTTP `/health` polling — no longer needed (server starts on demand).

### Migration from v0.1
1. `/plugin update claude-call@claude-call`
2. `/claude-call:setup` — paste credentials previously in `patter-mcp/.env`
3. Optionally `rm -rf ~/dev/patter-mcp`
```

- [ ] **Step 2: Commit**

```bash
cd "$REPO" && git add CHANGELOG.md && git commit -m "docs(changelog): document v0.2.0 breaking changes and migration"
```

---

### Task H3: Remove obsolete `scripts/preflight.sh` and its tests

**Files:**
- Delete: `scripts/preflight.sh`
- Delete: `tests/unit/preflight.bats`

- [ ] **Step 1: Delete files**

```bash
cd "$REPO" && rm scripts/preflight.sh tests/unit/preflight.bats
```

- [ ] **Step 2: Verify no remaining references**

```bash
cd "$REPO" && grep -rn 'preflight' . --include='*.sh' --include='*.md' --include='*.bats' --include='Makefile' --include='*.json' && echo "REFS REMAIN" || echo "CLEAN"
```
Expected: `CLEAN` (or only references inside CHANGELOG.md, which is fine).

- [ ] **Step 3: Run remaining bats tests to confirm green**

```bash
cd "$REPO" && bats tests/unit
```
Expected: all unit tests pass.

- [ ] **Step 4: Commit**

```bash
cd "$REPO" && git add -A && git commit -m "chore: remove obsolete preflight script and its test"
```

---

## Phase I — CI

### Task I1: Update `.github/workflows/ci.yml`

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Read existing workflow**

```bash
cat "$REPO/.github/workflows/ci.yml"
```

- [ ] **Step 2: Replace with extended workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  bats:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install bats + jq
        run: sudo apt-get update && sudo apt-get install -y bats jq
      - name: Run bats unit tests
        run: bats tests/unit

  server:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: server/package-lock.json
      - name: Install server deps
        working-directory: server
        run: npm ci
      - name: Build server
        working-directory: server
        run: npm run build
      - name: Typecheck
        working-directory: server
        run: npm run typecheck
      - name: Run tests
        working-directory: server
        run: npm test

  schema:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install jq
        run: sudo apt-get update && sudo apt-get install -y jq
      - name: Validate marketplace.json
        run: jq . .claude-plugin/marketplace.json > /dev/null
      - name: Validate plugin.json
        run: jq . .claude-plugin/plugin.json > /dev/null
      - name: Validate .mcp.json
        run: jq . .mcp.json > /dev/null
      - name: Validate hooks.json
        run: jq . hooks/hooks.json > /dev/null
```

- [ ] **Step 3: Run server tests + bats locally to validate before pushing**

```bash
cd "$REPO" && make ci
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
cd "$REPO" && git add .github/workflows/ci.yml && git commit -m "ci: add Node server build + test job (Ubuntu + macOS) and schema validation"
```

---

## Acceptance gate

Before tagging v0.2.0:

- [ ] All tests pass locally: `cd "$REPO" && make ci`
- [ ] CI green on a PR (Ubuntu + macOS server matrix + bats + schema validation)
- [ ] Manual smoke test on a fresh machine:
  - `/plugin marketplace add https://github.com/FrancescoRosciano/claude-call`
  - `/plugin install claude-call@claude-call`
  - `/claude-call:setup` walks through and reports all doctor checks PASS
  - `/call <personal-number> say hello` rings, AI disclosure spoken, conversation completes, structured outcome returned
  - `/calls` lists the just-completed call
- [ ] README install section accurate, no `patter-mcp` references
- [ ] CHANGELOG documents breaking changes

When all checked, tag and push:

```bash
cd "$REPO" && git tag v0.2.0 -m "v0.2.0: smooth setup — bundled MCP server, marketplace, /claude-call:setup wizard"
git push origin main --tags
```
