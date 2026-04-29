import { existsSync, readdirSync, readFileSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logEvent } from './log.js';
import { makeCall } from './tools/make_call.js';
import { callThirdParty } from './tools/call_third_party.js';
import { asToolError } from './errors.js';
const POLL_MS = 1000;
function queueDir() {
    return process.env.CLAUDE_CALL_FIRE_QUEUE ?? join(homedir(), '.claude-call', 'fire-queue');
}
function ensureDir() {
    const dir = queueDir();
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true, mode: 0o700 });
}
async function processOne(file, ctx) {
    const path = join(queueDir(), file);
    let req;
    try {
        req = JSON.parse(readFileSync(path, 'utf8'));
    }
    catch (err) {
        void logEvent({ event: 'fire_queue_parse_failed', file, error: err instanceof Error ? err.message : String(err) });
        unlinkSync(path);
        return;
    }
    void logEvent({ event: 'fire_queue_dispatch', tool: req.tool, source: req.source });
    try {
        if (req.tool === 'make_call') {
            await makeCall(ctx, req.args);
        }
        else if (req.tool === 'call_third_party') {
            await callThirdParty(ctx, req.args);
        }
    }
    catch (err) {
        const e = asToolError(err);
        void logEvent({ event: 'fire_queue_failed', tool: req.tool, code: e.code, message: e.message });
    }
    finally {
        try {
            unlinkSync(path);
        }
        catch { /* ignore */ }
    }
}
export function startFireQueueWatcher(getCtx) {
    ensureDir();
    let busy = false;
    const handle = setInterval(async () => {
        if (busy)
            return;
        const dir = queueDir();
        if (!existsSync(dir))
            return;
        const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
        if (files.length === 0)
            return;
        busy = true;
        try {
            const ctx = await getCtx();
            for (const f of files) {
                await processOne(f, ctx);
            }
        }
        catch (err) {
            void logEvent({ event: 'fire_queue_loop_error', error: err instanceof Error ? err.message : String(err) });
        }
        finally {
            busy = false;
        }
    }, POLL_MS);
    handle.unref();
}
export function enqueueFire(req, file) {
    ensureDir();
    const name = file ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    const path = join(queueDir(), name);
    writeFileSync(path, JSON.stringify(req), { mode: 0o600 });
    return path;
}
