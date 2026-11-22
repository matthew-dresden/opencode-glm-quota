import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import glmQuotaPlugin from '../../src/index.js';

type ToolExecutor = {
  execute: (args?: Record<string, unknown>, context?: Record<string, unknown>) => Promise<string> | string;
};

/**
 * Point HOME at an empty temp dir so discovery deterministically falls back
 * to the env-var credentials under test and never reads the real machine's
 * auth.json (which may hold any number of accounts).
 */
function stageEmptyHome(): () => void {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'glm-quota-noauth-'));
  const originalHome = process.env.HOME;
  process.env.HOME = tempHome;
  return () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  };
}

describe('Integration: Error Handling in src/index.ts', () => {
  test('should return Markdown error message when Date constructor throws', async () => {
    // Setup credentials to reach queryAllUsage
    process.env.ZAI_API_KEY = 'test-token';
    const cleanupHome = stageEmptyHome();

    // Mock Date to throw
    const originalDate = global.Date;

    try {
      class ThrowingDate extends Date {
        constructor(...args: ConstructorParameters<typeof Date>) {
          super(...args);
          throw new Error('Date failure');
        }
      }

      global.Date = ThrowingDate as DateConstructor;

      // Create plugin instance
      const plugin = await glmQuotaPlugin.server();
      const tool = plugin.tool!.glm_quota;

      const result = await (tool as unknown as ToolExecutor).execute();

      assert.ok(result.startsWith('### ⚠️ '), 'Output should start with a Markdown error title');
      assert.ok(!result.includes('╔') && !result.includes('╚'), 'Output should not contain box borders');
      assert.ok(result.includes('Date failure'), `Output should contain error message. Got: ${result}`);
    } finally {
      // Cleanup
      global.Date = originalDate;
      delete process.env.ZAI_API_KEY;
      cleanupHome();
    }
  });
});
