import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface Turn {
  role: 'agent' | 'user';
  text: string;
  ts: string;
}

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

export async function updateCall(
  callId: string,
  patch: Partial<CallRecord>,
  path?: string,
): Promise<void> {
  const target = path ?? defaultStorePath();
  const all = await readAll(target);
  const existing = all.find((r) => r.call_id === callId);
  const merged: CallRecord = existing
    ? { ...existing, ...patch }
    : ({ call_id: callId, ...patch } as CallRecord);
  await appendCall(merged, target);
}
