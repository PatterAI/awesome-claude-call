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
  const handle = setInterval(async () => {
    const armed = existsSync(flagPath());
    if (armed && !serving) {
      try {
        const ctx = await getCtx();
        await ctx.patter.serve({
          agent: { systemPrompt: INBOUND_PROMPT, ...(ctx.engineInstance ? { engine: ctx.engineInstance } : {}) },
          onTranscript: async (data: unknown) => {
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
        void logEvent({ event: 'inbound_serve_failed', error: err instanceof Error ? err.message : String(err) });
      }
    } else if (!armed && serving) {
      try {
        const ctx = await getCtx();
        await ctx.patter.disconnect();
        serving = false;
        void logEvent({ event: 'inbound_disarmed' });
      } catch (err) {
        void logEvent({ event: 'inbound_disconnect_failed', error: err instanceof Error ? err.message : String(err) });
      }
    }
  }, POLL_MS);
  handle.unref();
}

export function isInboundArmed(): boolean {
  return existsSync(flagPath());
}

export function readMessages(): { ts: string; text: string }[] {
  const path = messagesPath();
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { ts: string; text: string });
}
