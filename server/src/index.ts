#!/usr/bin/env node
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
    process.stdout.write('0.2.0\n');
    process.exit(0);
  }
  await startMcpServer();
}

main().catch((err) => {
  void logEvent({ event: 'fatal', error: String(err), stack: err instanceof Error ? err.stack : undefined });
  process.stderr.write(`claude-call server fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
