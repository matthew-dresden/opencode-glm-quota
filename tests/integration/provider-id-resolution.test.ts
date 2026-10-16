/**
 * Regression tests for the zai-max provider id (DEFECT: glm-quota v2.0.2
 * cannot discover credentials stored under provider id `zai-max`).
 *
 * getCredentials() iterates CANDIDATE_PROVIDER_IDS against auth.json. This
 * machine's auth.json stores the working API key under `zai-max`, which was
 * absent from the list, so every glm_quota call returned "Credentials Not
 * Found". These tests drive the real plugin entrypoint against a temp HOME
 * (the sole injection point of getAuthFilePathCandidates) and prove:
 *
 *   1. an auth.json entry keyed `zai-max` resolves (test passes only with the
 *      fix; reverting the candidate list turns this test red again);
 *   2. an entry keyed by an unknown provider id still hits the loud
 *      "Credentials Not Found" outcome — proving the temp auth.json is the
 *      file actually being read (no env-var masking, no real-file leakage).
 *
 * Hermeticity: ZAI_API_KEY/ZHIPU_API_KEY/ZHIPUAI_API_KEY are unset for the
 * duration, and a throwing Date mock aborts queryAllUsage at getTimeWindow()
 * BEFORE any network request — the established pattern from
 * tests/integration/error-handling.test.ts. "Date failure" in the output is
 * therefore proof that credential discovery succeeded and execution proceeded
 * past the credential gate.
 */

import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import glmQuotaPlugin from '../../src/index.js';

type ToolExecutor = {
  execute: (args?: Record<string, unknown>, context?: Record<string, unknown>) => Promise<string> | string;
};

/** Write a temp auth.json keyed by providerId and override HOME to point at it. */
function stageTempAuth(providerId: string): { tempHome: string; originalHome: string | undefined } {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'glm-quota-auth-'));
  const authDir = path.join(tempHome, '.local', 'share', 'opencode');
  fs.mkdirSync(authDir, { recursive: true });
  const entry = { type: 'api', key: 'test-fake-token-for-resolution-only' };
  fs.writeFileSync(path.join(authDir, 'auth.json'), JSON.stringify({ [providerId]: entry }));

  const originalHome = process.env.HOME;
  process.env.HOME = tempHome;
  return { tempHome, originalHome };
}

function withCredentialsGateScenario(providerId: string): Promise<string> {
  // Env-var fallbacks must be silenced so resolution can only come from auth.json.
  const envKeys = ['ZAI_API_KEY', 'ZHIPU_API_KEY', 'ZHIPUAI_API_KEY'];
  const savedEnv: Record<string, string | undefined> = {};
  for (const k of envKeys) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }

  const { tempHome, originalHome } = stageTempAuth(providerId);
  const originalDate = global.Date;

  class ThrowingDate extends Date {
    constructor(...args: ConstructorParameters<typeof Date>) {
      super(...args);
      throw new Error('Date failure');
    }
  }
  global.Date = ThrowingDate as DateConstructor;

  return (async () => {
    try {
      const plugin = await glmQuotaPlugin.server();
      const tool = plugin.tool!.glm_quota;
      return await (tool as unknown as ToolExecutor).execute();
    } finally {
      global.Date = originalDate;
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      fs.rmSync(tempHome, { recursive: true, force: true });
      for (const k of envKeys) {
        if (savedEnv[k] === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = savedEnv[k];
        }
      }
    }
  })();
}

describe('Integration: provider id credential resolution in src/index.ts', () => {
  test('resolves credentials from an auth.json entry keyed zai-max', async () => {
    const result = await withCredentialsGateScenario('zai-max');

    assert.ok(
      !result.includes('Credentials Not Found'),
      `zai-max entry must resolve; got: ${result}`
    );
    assert.ok(
      result.includes('Date failure'),
      `Execution must proceed past the credential gate to the mocked Date failure, proving resolution. Got: ${result}`
    );
  });

  test('still reports Credentials Not Found for an unknown provider id', async () => {
    const result = await withCredentialsGateScenario('totally-unknown-provider');

    assert.ok(
      result.includes('Credentials Not Found'),
      `Unknown provider id must hit the loud credential gate; got: ${result}`
    );
  });
});
