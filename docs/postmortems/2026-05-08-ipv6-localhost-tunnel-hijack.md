# Post-mortem: silent IPv6 tunnel hijack on hosts running Docker on `:8000`

**Date:** 2026-05-08
**Plugin version when discovered:** 0.2.3
**Fix shipped in:** 0.2.4
**Severity:** High — outbound calls connected on the carrier side, the user picked up, but heard total silence. `make_call` then hung for 5 minutes and returned `call_failed: exceeded 300000ms timeout`. No transcript was ever produced.
**Affected users:** Anyone running a Docker container that publishes ports `8000` or `8001` on all interfaces — including, by name, the official **`patter-dashboard`** container, which is exactly the kind of setup our power users have.

## Symptom

```
1. /claude-call:call-me +1XXXXXXXXXX "<objective>"
2. ☎ phone rings, user answers
3. … silence …
4. user hangs up
5. make_call sits for 300 s
6. tool_error: call CA<sid> exceeded 300000ms timeout
```

Logs in `~/.claude-call/log.ndjson` showed exactly four events per call and then nothing:

```
serving_started   mode=outbound
patter_built      engine=openai_realtime
call_dispatch     to=+1********999
call_initiated    call_id=CA…
…
tool_error        code=call_failed   message="call CA… exceeded 300000ms timeout"
```

The `call_end` SSE event from `Patter.metricsStore` never fired.

## What we expected

The flow for an outbound call in `getpatter@0.5.4` is:

1. `patter.serve({ tunnel: true })` starts a Cloudflare quick-tunnel that forwards `https://<random>.trycloudflare.com → http://localhost:<PORT>` and brings up the embedded Express + WebSocket server on the same `<PORT>`.
2. `patter.call({ to, … })` POSTs to the Twilio REST API with **inline TwiML**:
   ```xml
   <Response>
     <Connect>
       <Stream url="wss://<random>.trycloudflare.com/ws/stream/outbound"/>
     </Connect>
   </Response>
   ```
   plus `StatusCallback=https://<random>.trycloudflare.com/webhooks/twilio/status`.
3. Twilio dials the user. On answer, Twilio opens a WebSocket back through the tunnel to Patter, which bridges audio to OpenAI Realtime.
4. When the call ends, Twilio POSTs the status callback through the tunnel; Patter records the end and emits `call_end` on `metricsStore`.
5. `make_call` resolves on the `call_end` event with the full transcript.

## What actually happened

`localhost` resolution on the user's macOS host returned **`::1` (IPv6) before `127.0.0.1` (IPv4)**. The user was running:

```
$ docker ps --format "{{.Ports}}\t{{.Names}}"
0.0.0.0:8000-8001->8000-8001/tcp, [::]:8000-8001->8000-8001/tcp, …   patter-dashboard
```

The `patter-dashboard` container had bound `[::]:8000` and `[::]:8001`. The bundled Patter MCP server was correctly listening on `127.0.0.1:8000`. Both bindings coexisted on macOS because they target distinct address families.

`cloudflared` (started by `getpatter`'s `startTunnel(port)` with the literal string `"http://localhost:8000"`) forwarded tunnel traffic to **`::1:8000` → Docker's `patter-dashboard`**. The Patter server at `127.0.0.1:8000` saw zero traffic. Twilio's audio WebSocket was speaking to a container that didn't know how to handle it; the user's RTP stream went into a black hole; Twilio's status callback never reached Patter; `metricsStore.updateCallStatus(callSid, 'completed', …)` was never called; `call_end` was never published; `awaitCallEnd` timed out.

### Why this slipped past v0.2.3

v0.2.3 fixed a *prior* bug — `Cannot use both tunnel: true and webhookUrl. Pick one.` — by clearing `localConfig.webhookUrl` after every `disconnect()`. That fix was correct and necessary. But the tunnel-hijack bug only manifests **after** the tunnel comes up cleanly, so v0.2.3 actually exposed this second failure mode by removing the noisier symptom that had been masking it. The first call after upgrading to v0.2.3 looked like progress (the SDK error went away), then dropped silently.

### Why the very first call sometimes worked historically

Looking at the logs from May 3, exactly one outbound call in dozens completed with a real transcript. That call was preceded by a `Tunnel failed to start within 30s.` error and a sequence of `getpatter` retries. We hypothesize the SDK's retry path went through a branch that resolved the target host differently — possibly racing with a Docker container restart. We didn't pinpoint that path because it's not relevant once the IPv6 hijack is closed off entirely.

## How we found it

1. `~/.claude-call/log.ndjson` ended at `call_initiated` and resumed only when the 5-minute `awaitCallEnd` timeout fired with `tool_error: call_failed`. That isolated the failure to "Twilio thinks the call is up; Patter never hears about call_end."
2. `lsof -i :8000 -n -P` showed two listeners: `node 91870 IPv4 127.0.0.1:8000 LISTEN` *and* `com.docke 28849 IPv6 *:8000 LISTEN`.
3. `docker ps` confirmed the IPv6 listener was the `patter-dashboard` container.
4. Direct probes broke the symmetry:
   - `curl http://127.0.0.1:8000/health` → `{"status":"ok","mode":"local"}` (Patter responding).
   - `curl http://localhost:8000/` → empty body (Docker container, no matching route).
5. `python3 -c "import socket; print(socket.getaddrinfo('localhost', 8000, proto=socket.IPPROTO_TCP)[:2])"` returned the `AF_INET6 ::1` tuple **before** `AF_INET 127.0.0.1`, confirming IPv6-first resolution.

That's the evidence chain: address resolution prefers IPv6, Docker holds IPv6, Patter holds IPv4, the tunnel binary connects via name, the wrong process gets the audio.

## Fix (v0.2.4)

We do not control how `getpatter@0.5.4` constructs its tunnel target string (it hardcodes `"http://localhost:" + port`). The leverage point is the **port number**: pick one where Docker (or any other IPv6 listener) cannot intercept us.

Two changes in `server/src/patter.ts`:

1. **New module `port-discovery.ts`** — scans `[8002, 8099]` and returns the first port that is *both* (a) bindable on `127.0.0.1` and (b) silent on `::1`. The dual check is the load-bearing piece. Probing only IPv4 would miss the Docker hijack; probing only IPv6 would miss a stray IPv4 conflict.
2. **`ensureServing`** — calls `findFreePort()` once per `serve()` and threads the chosen port through `ServeOptions.port`. Logs `port_chosen` with the result for diagnostics. If `serve()` later fails on the chosen port (rare race; another process grabbed it between probe and bind), the existing error path surfaces the SDK's `EADDRINUSE` message; the next `make_call` will probe again from scratch.

We deliberately use a **range, not a single fallback port**, because:

- Future Docker / dev-server configurations vary widely. Hardcoding `8002` reproduces the original bug for anyone running a service on `8002`.
- The probe is cheap (~2 ms per port; total budget under 200 ms for a 98-port range even in the pathological all-busy case).
- The first call's success is the entire user experience. Spending 2 ms to pick the right port is trivial against the cost of a 5-minute silent failure.

`8002` as the range start is intentional: it sits one above the most common docker-compose default (`8000-8001`). The upper bound `8099` is arbitrary but generous; if you genuinely have 98 listeners on consecutive ports, you have other problems.

## Tests added

`server/tests/unit/port-discovery.test.ts`:

- Returns the first port when the range is fully free.
- Skips a port that is bound on `127.0.0.1`.
- Skips a port that has a listener on `::1` (simulates the Docker hijack scenario).
- Throws when every port in the range is unusable.

The tests bind real sockets on real ports inside `[18002, 18010]` (a deliberately-out-of-range probe band) and assert the expected port selection. No mocks: the contract we care about is "the network behavior, not the function shape."

## Lessons

1. **`localhost` is not a port; it's a name.** Any code that hands a hostname to a child process (cloudflared, ngrok, docker exec, ssh tunnels) is at the mercy of `getaddrinfo` ordering.
2. **Pick ports defensively for embedded servers.** Default-port collisions are quiet on Linux (which usually prefers IPv4) and loud on macOS (which prefers IPv6). Either way, probe.
3. **A successful network connect ≠ correctness.** Twilio reported the call as "answered." The user heard ringing. Both endpoints showed green. The data was being delivered to the wrong process in between. Verify the bridge, not just the endpoints.
4. **Silent failure modes get prioritized last and bite hardest.** A noisy "Cannot use both tunnel: true and webhookUrl" stack trace gets fixed quickly; "the user hears silence and we eventually time out at 5 minutes" reads like flakiness until you correlate the logs.

## Action items

- [x] Ship v0.2.4 with port-range discovery.
- [x] Add unit tests covering the IPv4-bind / IPv6-listener matrix.
- [x] Document the underlying SDK limitation in CHANGELOG so a future getpatter upgrade can drop the workaround.
- [ ] **Open getpatter issue:** ask the SDK to accept a custom tunnel target host (`127.0.0.1` instead of `localhost`) so embedded-server consumers don't have to fight DNS ordering at all.
- [ ] **Add a doctor check:** `claude-call doctor` should warn when an IPv6 listener is detected on the chosen port range, with a pointer to this post-mortem.
