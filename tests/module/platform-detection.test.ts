/**
 * Module tests for platform detection
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { detectPlatform, getPlatformName, type Platform } from '../../src/api/platforms.js';

describe('detectPlatform', () => {
  test('detects ZAI from zai-coding-plan', () => {
    assert.strictEqual(detectPlatform('zai-coding-plan'), 'ZAI');
  });

  test('detects ZAI from zai', () => {
    assert.strictEqual(detectPlatform('zai'), 'ZAI');
  });

  test('detects ZAI from z-ai', () => {
    assert.strictEqual(detectPlatform('z-ai'), 'ZAI');
  });

  test('detects ZAI from zai-max (legacy single account)', () => {
    assert.strictEqual(detectPlatform('zai-max'), 'ZAI');
  });

  test('detects ZAI from zai-max-brim (renamed multi-account host id)', () => {
    assert.strictEqual(detectPlatform('zai-max-brim'), 'ZAI');
  });

  test('detects ZAI from zai-max-accordion (second multi-account host id)', () => {
    assert.strictEqual(detectPlatform('zai-max-accordion'), 'ZAI');
  });

  test('detects ZAI from z.ai', () => {
    assert.strictEqual(detectPlatform('z.ai'), 'ZAI');
  });

  test('detects ZHIPU from zhipu', () => {
    assert.strictEqual(detectPlatform('zhipu'), 'ZHIPU');
  });

  test('detects ZHIPU from zhipuai', () => {
    assert.strictEqual(detectPlatform('zhipuai'), 'ZHIPU');
  });

  test('detects ZHIPU from bigmodel', () => {
    assert.strictEqual(detectPlatform('bigmodel'), 'ZHIPU');
  });

  test('detects ZHIPU from dev.bigmodel.cn', () => {
    assert.strictEqual(detectPlatform('dev.bigmodel.cn'), 'ZHIPU');
  });

  test('returns null for unknown provider', () => {
    assert.strictEqual(detectPlatform('unknown'), null);
  });

  test('is case insensitive', () => {
    assert.strictEqual(detectPlatform('ZAI'), 'ZAI');
    assert.strictEqual(detectPlatform('Zhipu'), 'ZHIPU');
  });
});

describe('getPlatformName', () => {
  test('returns Z.AI for ZAI platform', () => {
    assert.strictEqual(getPlatformName('ZAI'), 'Z.AI');
  });

  test('returns ZHIPU for ZHIPU platform', () => {
    assert.strictEqual(getPlatformName('ZHIPU'), 'ZHIPU');
  });
});
