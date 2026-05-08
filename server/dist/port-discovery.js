import * as net from 'node:net';
/**
 * Defaults for the Patter embedded HTTP/WebSocket server port.
 *
 * We start at 8002 — one above the most common docker-compose default
 * (8000-8001). Why we do not just use 8000 is the subject of
 * `docs/postmortems/2026-05-08-ipv6-localhost-tunnel-hijack.md`. tl;dr: macOS
 * resolves `localhost` to `::1` first, and any Docker container that maps
 * `[::]:8000` (e.g. the official `patter-dashboard`) silently steals the
 * Cloudflare tunnel's traffic away from the real Patter server on
 * `127.0.0.1:8000`. A port range plus a probe is the right shape: we cannot
 * predict the user's port collisions, and the probe budget is cheap.
 *
 * Range upper bound is generous; if 98 consecutive ports are unusable, the
 * thrown error will help the operator notice it.
 */
export const DEFAULT_PORT_RANGE_START = 8002;
export const DEFAULT_PORT_RANGE_END = 8099;
/**
 * How long we wait for a TCP connect on `::1:port` to settle before we treat
 * silence as "no IPv6 listener." Loopback is essentially instantaneous, so
 * 200 ms is two orders of magnitude over what we need but stays well under
 * any user-visible budget even if the whole range is probed.
 */
const PROBE_TIMEOUT_MS = 200;
/**
 * Probe whether `port` is usable for the Patter embedded server.
 *
 * Returns `usable: true` only when BOTH conditions hold:
 *   1. We can bind a server to `127.0.0.1:port` — i.e. nothing else owns the
 *      IPv4 loopback for that port.
 *   2. Nothing answers a TCP connect on `::1:port` — i.e. no IPv6 listener
 *      can hijack tunnel traffic when `cloudflared` connects to
 *      `localhost:port` and macOS resolves the name to `::1` first.
 *
 * Both halves are load-bearing: dropping (1) lets us pick a port the SDK
 * will fail to bind; dropping (2) reproduces the original tunnel-hijack bug.
 */
async function probePort(port) {
    const ipv4Bindable = await canBindIpv4(port);
    if (!ipv4Bindable)
        return { usable: false, reason: 'ipv4_in_use' };
    const ipv6Empty = await ipv6LoopbackHasNoListener(port);
    if (!ipv6Empty)
        return { usable: false, reason: 'ipv6_listener_present' };
    return { usable: true };
}
function canBindIpv4(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        let settled = false;
        server.once('error', () => {
            if (settled)
                return;
            settled = true;
            server.removeAllListeners();
            resolve(false);
        });
        server.once('listening', () => {
            if (settled)
                return;
            settled = true;
            server.removeAllListeners();
            // Wait for the close to fully release the port before the caller probes
            // the next candidate; otherwise rapid sequential probes can race against
            // TIME_WAIT and report a false `ipv4_in_use`.
            server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
    });
}
function ipv6LoopbackHasNoListener(port) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;
        const settle = (empty) => {
            if (settled)
                return;
            settled = true;
            socket.removeAllListeners();
            socket.destroy();
            resolve(empty);
        };
        socket.setTimeout(PROBE_TIMEOUT_MS);
        socket.once('connect', () => settle(false)); // someone answered → not empty
        socket.once('error', () => settle(true)); // ECONNREFUSED / ENETUNREACH → empty
        socket.once('timeout', () => settle(true));
        socket.connect(port, '::1');
    });
}
/**
 * Find the first port in `[start, end]` that is usable for the Patter
 * embedded server (see `probePort` for the definition of "usable").
 *
 * Throws when every port in the range fails the probe.
 */
export async function findFreePort(opts = {}) {
    const start = opts.start ?? DEFAULT_PORT_RANGE_START;
    const end = opts.end ?? DEFAULT_PORT_RANGE_END;
    if (start > end) {
        throw new RangeError(`findFreePort: start (${start}) must be <= end (${end})`);
    }
    for (let port = start; port <= end; port++) {
        const result = await probePort(port);
        if (result.usable)
            return port;
        if (opts.onSkip && result.reason)
            opts.onSkip(port, result.reason);
    }
    throw new Error(`No usable port in [${start}, ${end}]. Every candidate is either bound on 127.0.0.1 or has an IPv6 listener that would hijack the Cloudflare tunnel.`);
}
