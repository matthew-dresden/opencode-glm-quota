/**
 * Unit tests for API key masking.
 *
 * Requirement: keys are NEVER printed. Anywhere a key would appear in output
 * or logs it must be masked to first4/last4 (e.g. `aaaa...dddd`), and keys
 * too short to split safely must reveal no characters at all.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { maskKey } from '../../src/utils/key-masking.js';

describe('maskKey', () => {
  test('masks a key to first4 and last4 separated by three dots', () => {
    assert.strictEqual(maskKey('aaaabbbbccccdddd'), 'aaaa...dddd');
  });

  test('keeps only the first and last four characters', () => {
    const masked = maskKey('brim0fake0000key9999zzzz');
    assert.strictEqual(masked, 'brim...zzzz');
    assert.ok(!masked.includes('fake'), 'middle characters must never appear');
  });

  test('masks short keys fully without revealing any character', () => {
    assert.strictEqual(maskKey('short'), '*****');
    assert.strictEqual(maskKey('12345678'), '********');
  });

  test('returns empty string for empty keys', () => {
    assert.strictEqual(maskKey(''), '');
  });

  test('output length is stable regardless of input length beyond the split points', () => {
    assert.strictEqual(maskKey('a'.repeat(9)).length, 11);
    assert.strictEqual(maskKey('a'.repeat(64)).length, 11);
  });
});
