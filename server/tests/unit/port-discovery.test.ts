import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'node:net';
import { findFreePort } from '../../src/port-discovery.js';

// Probe band well outside the production default range [8002, 8099] so a
// dev machine running this test cannot collide with a real Patter / Docker
// listener and produce a confusing failure.
const TEST_RANGE_START = 18002;
const TEST_RANGE_END = 18010;

interface BoundServer {
  server: net.Server;
  port: number;
  host: string;
}

const bound: BoundServer[] = [];

function listenOn(host: string, port: number): Promise<BoundServer> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.once('listening', () => {
      const handle: BoundServer = { server, port, host };
      bound.push(handle);
      resolve(handle);
    });
    server.listen(port, host);
  });
}

function closeAll(): Promise<void> {
  return Promise.all(
    bound.splice(0).map(
      (b) =>
        new Promise<void>((resolve) => {
          b.server.close(() => resolve());
        }),
    ),
  ).then(() => undefined);
}

after(async () => {
  await closeAll();
});

describe('port-discovery — findFreePort', () => {
  it('returns the first port when the range is fully free', async () => {
    const chosen = await findFreePort({
      start: TEST_RANGE_START,
      end: TEST_RANGE_END,
    });
    assert.equal(chosen, TEST_RANGE_START);
  });

  it('skips a port that is already bound on 127.0.0.1', async () => {
    await listenOn('127.0.0.1', TEST_RANGE_START);
    const skipped: number[] = [];
    const chosen = await findFreePort({
      start: TEST_RANGE_START,
      end: TEST_RANGE_END,
      onSkip: (p, reason) => {
        if (reason === 'ipv4_in_use') skipped.push(p);
      },
    });
    assert.equal(chosen, TEST_RANGE_START + 1);
    assert.deepEqual(skipped, [TEST_RANGE_START]);
    await closeAll();
  });

  it('skips a port that has a listener on ::1 (IPv6 hijack risk)', async () => {
    // This is the production bug we are guarding against:
    // Patter could bind 127.0.0.1:port just fine, but the Cloudflare tunnel
    // would resolve `localhost` to ::1 first and route audio to whatever
    // owns ::1:port (Docker, in the original report).
    await listenOn('::1', TEST_RANGE_START);
    const skipped: { port: number; reason: string }[] = [];
    const chosen = await findFreePort({
      start: TEST_RANGE_START,
      end: TEST_RANGE_END,
      onSkip: (p, reason) => skipped.push({ port: p, reason }),
    });
    assert.equal(chosen, TEST_RANGE_START + 1);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0]?.port, TEST_RANGE_START);
    assert.equal(skipped[0]?.reason, 'ipv6_listener_present');
    await closeAll();
  });

  it('throws when every port in the range is unusable', async () => {
    // Block both halves on a single port and use a one-port range to keep
    // the test cheap.
    await listenOn('127.0.0.1', TEST_RANGE_START);
    await assert.rejects(
      () => findFreePort({ start: TEST_RANGE_START, end: TEST_RANGE_START }),
      /No usable port/,
    );
    await closeAll();
  });

  it('throws on an inverted range', async () => {
    await assert.rejects(
      () => findFreePort({ start: TEST_RANGE_END, end: TEST_RANGE_START }),
      /start .* must be <= end/,
    );
  });
});
