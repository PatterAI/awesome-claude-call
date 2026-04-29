import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logEvent } from './log.js';
const POLL_MS = 1000;
function flagPath() {
    return process.env.CLAUDE_CALL_INBOUND_FLAG ?? join(homedir(), '.claude-call', 'inbound-armed');
}
function messagesPath() {
    return process.env.CLAUDE_CALL_MESSAGES ?? join(homedir(), '.claude-call', 'messages.ndjson');
}
const INBOUND_PROMPT = `You are Claude Code's voice channel for Francesco. Take messages and answer general questions politely. You cannot execute Claude Code commands; if the caller asks for a code action, take the message and tell them you'll relay it. Identify yourself on the first turn as "an AI assistant for Francesco's Claude Code session". If asked whether you are human, answer truthfully.`;
export function startInboundWatcher(getCtx) {
    let serving = false;
    const handle = setInterval(async () => {
        const armed = existsSync(flagPath());
        if (armed && !serving) {
            try {
                const ctx = await getCtx();
                await ctx.patter.serve({
                    agent: { systemPrompt: INBOUND_PROMPT, ...(ctx.engineInstance ? { engine: ctx.engineInstance } : {}) },
                    onTranscript: async (data) => {
                        const text = String(data.text ?? '');
                        if (text) {
                            const { appendFile } = await import('node:fs/promises');
                            const line = JSON.stringify({ ts: new Date().toISOString(), text }) + '\n';
                            await appendFile(messagesPath(), line, 'utf8');
                        }
                    },
                });
                serving = true;
                void logEvent({ event: 'inbound_armed' });
            }
            catch (err) {
                void logEvent({ event: 'inbound_serve_failed', error: err instanceof Error ? err.message : String(err) });
            }
        }
        else if (!armed && serving) {
            try {
                const ctx = await getCtx();
                await ctx.patter.disconnect();
                serving = false;
                void logEvent({ event: 'inbound_disarmed' });
            }
            catch (err) {
                void logEvent({ event: 'inbound_disconnect_failed', error: err instanceof Error ? err.message : String(err) });
            }
        }
    }, POLL_MS);
    handle.unref();
}
export function isInboundArmed() {
    return existsSync(flagPath());
}
export function readMessages() {
    const path = messagesPath();
    if (!existsSync(path))
        return [];
    return readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
}
