import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PatterContext } from './patter.js';
import { ensureServing, stopServing, currentServingMode } from './patter.js';
import { logEvent } from './log.js';

const POLL_MS = 1000;

function flagPath(): string {
  return process.env.CLAUDE_CALL_INBOUND_FLAG ?? join(homedir(), '.claude-call', 'inbound-armed');
}

function messagesPath(): string {
  return process.env.CLAUDE_CALL_MESSAGES ?? join(homedir(), '.claude-call', 'messages.ndjson');
}

const INBOUND_PROMPT = `You are Claude Code's voice channel for Francesco. Take messages and answer general questions politely. You cannot execute Claude Code commands; if the caller asks for a code action, take the message and tell them you'll relay it. Identify yourself on the first turn as "an AI assistant for Francesco's Claude Code session". If asked whether you are human, answer truthfully.`;

async function appendInboundTranscript(data: unknown): Promise<void> {
  const text = String((data as { text?: string }).text ?? '');
  if (!text) return;
  const { appendFile } = await import('node:fs/promises');
  const line = JSON.stringify({ ts: new Date().toISOString(), text }) + '\n';
  await appendFile(messagesPath(), line, 'utf8');
}

export function startInboundWatcher(getCtx: () => Promise<PatterContext>): void {
  // Re-entry guard: at most one in-flight transition at a time.
  // setInterval keeps firing every POLL_MS regardless of how long the async body
  // takes, so without this guard concurrent ticks would call ensureServing /
  // stopServing in parallel and clobber state owned by make_call.
  let inFlight: Promise<void> | null = null;

  const handle = setInterval(() => {
    if (inFlight) return;
    const armed = existsSync(flagPath());
    const mode = currentServingMode();
    // Decide whether *this watcher* needs to act.
    // - The watcher owns the 'inbound' mode only. 'placeholder' belongs to make_call.
    // - Never touch 'placeholder' here, even when the flag is unarmed.
    const needsArm = armed && mode !== 'inbound';
    const needsDisarm = !armed && mode === 'inbound';
    if (!needsArm && !needsDisarm) return;

    inFlight = (async () => {
      try {
        const ctx = await getCtx();
        if (needsArm) {
          await ensureServing(ctx, {
            mode: 'inbound',
            systemPrompt: INBOUND_PROMPT,
            onTranscript: appendInboundTranscript,
          });
          void logEvent({ event: 'inbound_armed' });
        } else if (needsDisarm) {
          await stopServing(ctx);
          void logEvent({ event: 'inbound_disarmed' });
        }
      } catch (err) {
        void logEvent({ event: 'inbound_state_change_failed', error: err instanceof Error ? err.message : String(err) });
      } finally {
        inFlight = null;
      }
    })();
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
