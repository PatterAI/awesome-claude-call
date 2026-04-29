import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactPhone } from '../../src/redact.js';

describe('redactPhone', () => {
  it('keeps +<2-digit-country-code> prefix and last-4, masks middle', () => {
    assert.equal(redactPhone('+393331234567'), '+39******4567');
    assert.equal(redactPhone('+15551234567'), '+15*****4567');
  });

  it('returns empty string for empty input', () => {
    assert.equal(redactPhone(''), '');
  });

  it('returns input unchanged when ≤ 4 chars', () => {
    assert.equal(redactPhone('123'), '123');
    assert.equal(redactPhone('1234'), '1234');
  });

  it('preserves leading + and digits in the first 3 positions', () => {
    assert.match(redactPhone('+44 7700 900123'), /^\+44.*0123$/);
  });
});
