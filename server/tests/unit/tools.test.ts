import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateMakeCallInput } from '../../src/tools/make_call.js';
import { validateCallThirdPartyInput } from '../../src/tools/call_third_party.js';

describe('validateMakeCallInput', () => {
  it('rejects non-E.164 numbers', () => {
    assert.throws(() => validateMakeCallInput({ to: '5551234567', system_prompt: 'hi' }), /E\.164/);
  });

  it('rejects missing system_prompt', () => {
    assert.throws(() => validateMakeCallInput({ to: '+15551234567' } as never), /system_prompt/);
  });

  it('rejects oversize system_prompt', () => {
    const big = 'x'.repeat(8001);
    assert.throws(() => validateMakeCallInput({ to: '+15551234567', system_prompt: big }), /8000/);
  });

  it('accepts valid input', () => {
    const v = validateMakeCallInput({ to: '+15551234567', system_prompt: 'Be helpful.', first_message: 'Hi' });
    assert.equal(v.to, '+15551234567');
    assert.equal(v.first_message, 'Hi');
  });
});

describe('validateCallThirdPartyInput', () => {
  it('rejects empty objective', () => {
    assert.throws(() => validateCallThirdPartyInput({ to: '+15551234567', objective: '' }), /objective/);
  });

  it('rejects oversize objective', () => {
    assert.throws(() => validateCallThirdPartyInput({ to: '+15551234567', objective: 'x'.repeat(2001) }), /2000/);
  });

  it('clamps max_turns to [1, 30]', () => {
    assert.equal(validateCallThirdPartyInput({ to: '+15551234567', objective: 'book', max_turns: 100 }).max_turns, 30);
    assert.equal(validateCallThirdPartyInput({ to: '+15551234567', objective: 'book', max_turns: 0 }).max_turns, 1);
  });

  it('accepts valid input with default max_turns=10', () => {
    const v = validateCallThirdPartyInput({ to: '+15551234567', objective: 'Book a table' });
    assert.equal(v.max_turns, 10);
  });
});

import { validateGetCallsInput } from '../../src/tools/get_calls.js';

describe('validateGetCallsInput', () => {
  it('defaults limit to 20', () => {
    assert.equal(validateGetCallsInput({}).limit, 20);
  });

  it('clamps limit to [1, 200]', () => {
    assert.equal(validateGetCallsInput({ limit: 1000 }).limit, 200);
    assert.equal(validateGetCallsInput({ limit: 0 }).limit, 1);
  });

  it('rejects malformed since timestamp', () => {
    assert.throws(() => validateGetCallsInput({ since: 'yesterday' }), /ISO8601/);
  });

  it('accepts valid since timestamp', () => {
    const v = validateGetCallsInput({ since: '2026-04-28T10:00:00Z' });
    assert.equal(v.since, '2026-04-28T10:00:00Z');
  });
});

import { validateGetTranscriptInput } from '../../src/tools/get_transcript.js';

describe('validateGetTranscriptInput', () => {
  it('rejects missing call_id', () => {
    assert.throws(() => validateGetTranscriptInput({} as never), /call_id/);
  });

  it('rejects empty call_id', () => {
    assert.throws(() => validateGetTranscriptInput({ call_id: '' }), /call_id/);
  });

  it('accepts non-empty call_id', () => {
    assert.equal(validateGetTranscriptInput({ call_id: 'CA1' }).call_id, 'CA1');
  });
});
