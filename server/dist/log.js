import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { redactPhone } from './redact.js';
const PHONE_FIELDS = new Set(['to', 'from', 'phone', 'number', 'callee', 'caller']);
function defaultLogPath() {
    return process.env.CLAUDE_CALL_LOG ?? join(homedir(), '.claude-call', 'log.ndjson');
}
function redactEntry(entry) {
    const out = {};
    for (const [k, v] of Object.entries(entry)) {
        if (PHONE_FIELDS.has(k) && typeof v === 'string') {
            out[k] = redactPhone(v);
        }
        else {
            out[k] = v;
        }
    }
    return out;
}
export async function logEvent(entry, path) {
    const target = path ?? defaultLogPath();
    await mkdir(dirname(target), { recursive: true });
    const line = JSON.stringify({ ...redactEntry(entry), ts: new Date().toISOString() });
    await appendFile(target, line + '\n', 'utf8');
}
