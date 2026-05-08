import { Patter, Twilio, OpenAIRealtime, ElevenLabsConvAI, CloudflareTunnel, } from 'getpatter';
import { logEvent } from './log.js';
import { findFreePort } from './port-discovery.js';
let cached;
let servingState = null;
/**
 * Workaround for getpatter <=0.5.4: `Patter.disconnect()` stops the tunnel
 * handle but leaves `localConfig.webhookUrl` set to the prior tunnel's
 * hostname. The next `serve()` then trips the `tunnel + webhookUrl` guard
 * and throws "Cannot use both tunnel: true and webhookUrl. Pick one."
 *
 * Reach into the SDK's internal state after each disconnect and clear it.
 * Remove this when getpatter ships a fix in disconnect().
 */
function clearStalePatterWebhookUrl(patter) {
    const internal = patter;
    if (internal.localConfig && internal.localConfig.webhookUrl !== undefined) {
        internal.localConfig = { ...internal.localConfig, webhookUrl: undefined };
    }
}
function targetKey(t) {
    // Sort tool names so reordering the input array doesn't trigger a spurious
    // disconnect+reconnect when the agent identity is logically the same.
    const toolNames = [...(t.tools ?? [])].map((x) => x.name).sort().join(',');
    return JSON.stringify({
        m: t.mode,
        p: t.systemPrompt,
        f: t.firstMessage ?? '',
        tn: toolNames,
    });
}
export function buildPatter(creds) {
    if (cached && cached.credentials === creds)
        return cached;
    const carrier = new Twilio({ accountSid: creds.TWILIO_ACCOUNT_SID, authToken: creds.TWILIO_AUTH_TOKEN });
    const patter = new Patter({
        carrier,
        phoneNumber: creds.TWILIO_PHONE_NUMBER,
        tunnel: new CloudflareTunnel(),
    });
    let engineInstance;
    if (creds.VOICE_ENGINE === 'openai_realtime' && creds.OPENAI_API_KEY) {
        engineInstance = new OpenAIRealtime({ apiKey: creds.OPENAI_API_KEY });
    }
    else if (creds.VOICE_ENGINE === 'elevenlabs_convai' && creds.ELEVENLABS_API_KEY && creds.ELEVENLABS_AGENT_ID) {
        engineInstance = new ElevenLabsConvAI({ apiKey: creds.ELEVENLABS_API_KEY, agentId: creds.ELEVENLABS_AGENT_ID });
    }
    cached = { patter, engine: creds.VOICE_ENGINE, phoneNumber: creds.TWILIO_PHONE_NUMBER, engineInstance, credentials: creds };
    void logEvent({ event: 'patter_built', engine: creds.VOICE_ENGINE });
    return cached;
}
/**
 * Ensure the bundled Patter server is serving with the given agent.
 *
 * The SDK stores exactly one agent per `serve()` call (`embeddedServer.this.agent`).
 * The agent passed to `phone.call()` is currently ignored by the SDK — the
 * webhook routes ALL audio to the serving agent. So to place an outbound call
 * with a custom agent, we must serve() with that agent first.
 *
 * If already serving with the same agent identity (mode + prompt + firstMessage
 * + tool names), this is a no-op. Otherwise it disconnects the prior tunnel
 * and re-spawns with the new agent — costs ~3-5s for Cloudflare to bind.
 */
export async function ensureServing(ctx, target) {
    const key = targetKey(target);
    if (servingState?.key === key)
        return servingState.promise;
    if (servingState) {
        await servingState.promise.catch(() => undefined);
        try {
            await ctx.patter.disconnect();
        }
        catch (err) {
            void logEvent({ event: 'serving_disconnect_failed', error: err instanceof Error ? err.message : String(err) });
        }
        clearStalePatterWebhookUrl(ctx.patter);
        servingState = null;
    }
    // Probe a port range and pick one where (a) Patter can bind on 127.0.0.1
    // AND (b) no IPv6 listener at ::1:<port> can hijack tunnel traffic.
    // getpatter@0.5.4 targets `http://localhost:<port>`, which on macOS resolves
    // to ::1 first — any Docker container on [::]:8000-8001 silently steals audio.
    const port = await findFreePort({
        onSkip: (skippedPort, reason) => void logEvent({ event: 'port_skipped', port: skippedPort, reason }),
    });
    void logEvent({ event: 'port_chosen', port });
    const serveOpts = {
        port,
        agent: {
            systemPrompt: target.systemPrompt,
            ...(target.firstMessage ? { firstMessage: target.firstMessage } : {}),
            ...(target.tools ? { tools: target.tools } : {}),
            ...(ctx.engineInstance ? { engine: ctx.engineInstance } : {}),
        },
        ...(target.onTranscript ? { onTranscript: target.onTranscript } : {}),
    };
    const promise = ctx.patter.serve(serveOpts);
    servingState = { mode: target.mode, promise, key };
    void logEvent({ event: 'serving_started', mode: target.mode });
    await promise;
}
export async function stopServing(ctx) {
    if (!servingState)
        return;
    await servingState.promise.catch(() => undefined);
    try {
        await ctx.patter.disconnect();
    }
    catch (err) {
        void logEvent({ event: 'serving_disconnect_failed', error: err instanceof Error ? err.message : String(err) });
    }
    clearStalePatterWebhookUrl(ctx.patter);
    servingState = null;
    void logEvent({ event: 'serving_stopped' });
}
export function currentServingMode() {
    return servingState?.mode ?? null;
}
export async function disposePatter() {
    if (!cached)
        return;
    try {
        await cached.patter.disconnect();
    }
    catch (err) {
        void logEvent({ event: 'patter_dispose_error', error: String(err) });
    }
    clearStalePatterWebhookUrl(cached.patter);
    cached = undefined;
    servingState = null;
}
export function __resetForTests() {
    cached = undefined;
    servingState = null;
}
