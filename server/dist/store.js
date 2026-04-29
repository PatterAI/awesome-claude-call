import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
export function defaultStorePath() {
    return process.env.CLAUDE_CALL_STORE ?? join(homedir(), '.claude-call', 'calls.ndjson');
}
export async function appendCall(rec, path) {
    const target = path ?? defaultStorePath();
    await mkdir(dirname(target), { recursive: true });
    await appendFile(target, JSON.stringify(rec) + '\n', 'utf8');
}
async function readAll(path) {
    if (!existsSync(path))
        return [];
    const content = await readFile(path, 'utf8');
    const out = [];
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            out.push(JSON.parse(trimmed));
        }
        catch {
            // Skip malformed lines silently — store is forward-compatible.
        }
    }
    return out;
}
export async function listCalls(opts = {}, path) {
    const all = await readAll(path ?? defaultStorePath());
    let filtered = all;
    if (opts.since) {
        filtered = filtered.filter((r) => r.started_at >= opts.since);
    }
    filtered.sort((a, b) => (b.started_at > a.started_at ? 1 : -1));
    if (opts.limit !== undefined)
        filtered = filtered.slice(0, opts.limit);
    return filtered;
}
export async function getCall(callId, path) {
    const all = await readAll(path ?? defaultStorePath());
    return all.find((r) => r.call_id === callId) ?? null;
}
export async function updateCall(callId, patch, path) {
    const target = path ?? defaultStorePath();
    const all = await readAll(target);
    const existing = all.find((r) => r.call_id === callId);
    const merged = existing
        ? { ...existing, ...patch }
        : { call_id: callId, ...patch };
    await appendCall(merged, target);
}
