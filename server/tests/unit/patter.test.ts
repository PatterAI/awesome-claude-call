import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureServing,
  stopServing,
  currentServingMode,
  __resetForTests,
  type PatterContext,
} from '../../src/patter.js';
import type { Tool } from 'getpatter';

interface ServeOpts {
  agent: { systemPrompt: string; tools?: { name: string }[] };
  onTranscript?: unknown;
}

interface RecordedEvent {
  type: 'serve' | 'disconnect';
  data?: ServeOpts;
}

function fakeContext(): { ctx: PatterContext; events: RecordedEvent[] } {
  const events: RecordedEvent[] = [];
  const fakePatter = {
    serve: async (opts: ServeOpts): Promise<void> => {
      events.push({ type: 'serve', data: opts });
    },
    disconnect: async (): Promise<void> => {
      events.push({ type: 'disconnect' });
    },
    metricsStore: null,
  };
  const ctx = {
    patter: fakePatter,
    engine: 'openai_realtime',
    phoneNumber: '+15551234567',
    engineInstance: undefined,
    credentials: {},
  } as unknown as PatterContext;
  return { ctx, events };
}

const t = (name: string): Tool => ({ name } as unknown as Tool);

describe('patter.ts — ensureServing', () => {
  beforeEach(() => __resetForTests());

  it('serves once on first invocation', async () => {
    const { ctx, events } = fakeContext();
    await ensureServing(ctx, { mode: 'outbound', systemPrompt: 'hi' });
    assert.equal(events.filter((e) => e.type === 'serve').length, 1);
    assert.equal(events.filter((e) => e.type === 'disconnect').length, 0);
    assert.equal(currentServingMode(), 'outbound');
  });

  it('is idempotent for the same target key', async () => {
    const { ctx, events } = fakeContext();
    await ensureServing(ctx, { mode: 'outbound', systemPrompt: 'hi' });
    await ensureServing(ctx, { mode: 'outbound', systemPrompt: 'hi' });
    await ensureServing(ctx, { mode: 'outbound', systemPrompt: 'hi' });
    assert.equal(events.filter((e) => e.type === 'serve').length, 1);
    assert.equal(events.filter((e) => e.type === 'disconnect').length, 0);
  });

  it('disconnects + reserves when systemPrompt changes', async () => {
    const { ctx, events } = fakeContext();
    await ensureServing(ctx, { mode: 'outbound', systemPrompt: 'hi' });
    await ensureServing(ctx, { mode: 'outbound', systemPrompt: 'bye' });
    assert.equal(events.filter((e) => e.type === 'serve').length, 2);
    assert.equal(events.filter((e) => e.type === 'disconnect').length, 1);
  });

  it('disconnects + reserves when mode changes', async () => {
    const { ctx, events } = fakeContext();
    await ensureServing(ctx, { mode: 'outbound', systemPrompt: 'p' });
    await ensureServing(ctx, { mode: 'inbound', systemPrompt: 'p' });
    assert.equal(events.filter((e) => e.type === 'serve').length, 2);
    assert.equal(events.filter((e) => e.type === 'disconnect').length, 1);
    assert.equal(currentServingMode(), 'inbound');
  });

  it('disconnects + reserves when firstMessage changes', async () => {
    const { ctx, events } = fakeContext();
    await ensureServing(ctx, { mode: 'outbound', systemPrompt: 'p', firstMessage: 'hi' });
    await ensureServing(ctx, { mode: 'outbound', systemPrompt: 'p', firstMessage: 'hello' });
    assert.equal(events.filter((e) => e.type === 'serve').length, 2);
    assert.equal(events.filter((e) => e.type === 'disconnect').length, 1);
  });

  it('treats reordered tools as the same identity (no reconnect)', async () => {
    const { ctx, events } = fakeContext();
    await ensureServing(ctx, { mode: 'outbound', systemPrompt: 'p', tools: [t('a'), t('b')] });
    await ensureServing(ctx, { mode: 'outbound', systemPrompt: 'p', tools: [t('b'), t('a')] });
    assert.equal(events.filter((e) => e.type === 'serve').length, 1);
    assert.equal(events.filter((e) => e.type === 'disconnect').length, 0);
  });

  it('treats different tool sets as different identities', async () => {
    const { ctx, events } = fakeContext();
    await ensureServing(ctx, { mode: 'outbound', systemPrompt: 'p', tools: [t('a')] });
    await ensureServing(ctx, { mode: 'outbound', systemPrompt: 'p', tools: [t('a'), t('b')] });
    assert.equal(events.filter((e) => e.type === 'serve').length, 2);
    assert.equal(events.filter((e) => e.type === 'disconnect').length, 1);
  });

  it('forwards onTranscript when provided', async () => {
    const { ctx, events } = fakeContext();
    const onTranscript = async (): Promise<void> => undefined;
    await ensureServing(ctx, { mode: 'inbound', systemPrompt: 'p', onTranscript });
    const serve = events.find((e) => e.type === 'serve');
    assert.ok(serve);
    assert.equal((serve.data as ServeOpts & { onTranscript?: unknown }).onTranscript, onTranscript);
  });
});

describe('patter.ts — stopServing', () => {
  beforeEach(() => __resetForTests());

  it('disconnects current serving and clears mode', async () => {
    const { ctx, events } = fakeContext();
    await ensureServing(ctx, { mode: 'inbound', systemPrompt: 'p' });
    await stopServing(ctx);
    assert.equal(events.filter((e) => e.type === 'disconnect').length, 1);
    assert.equal(currentServingMode(), null);
  });

  it('is a no-op when nothing is serving', async () => {
    const { ctx, events } = fakeContext();
    await stopServing(ctx);
    assert.equal(events.filter((e) => e.type === 'disconnect').length, 0);
    assert.equal(currentServingMode(), null);
  });
});

describe('patter.ts — currentServingMode', () => {
  beforeEach(() => __resetForTests());

  it('returns null before any serve', () => {
    assert.equal(currentServingMode(), null);
  });

  it('reflects the last successful mode', async () => {
    const { ctx } = fakeContext();
    await ensureServing(ctx, { mode: 'outbound', systemPrompt: 'p' });
    assert.equal(currentServingMode(), 'outbound');
    await ensureServing(ctx, { mode: 'inbound', systemPrompt: 'p' });
    assert.equal(currentServingMode(), 'inbound');
    await stopServing(ctx);
    assert.equal(currentServingMode(), null);
  });
});
