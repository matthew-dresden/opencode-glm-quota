/**
 * Multi-account tests for the zai-max provider family (v2.0.5).
 *
 * The host opencode config renames provider id `zai-max` to `zai-max-brim`
 * and adds a second account `zai-max-accordion`. Discovery must therefore
 * find EVERY auth.json entry whose key starts with `zai-max` (prefix match,
 * covering the legacy single `zai-max` id too), query the quota API once per
 * discovered key, and render one clearly labeled section per account.
 *
 * Contract under test:
 *   1. Prefix discovery: `zai-max*` entries are all discovered, including the
 *      legacy `zai-max` id; legacy exact ids (`zai-coding-plan`, `zhipu`, ...)
 *      keep resolving; zero matches keeps the loud "Credentials Not Found".
 *   2. Rendering: the auth.json key labels each account section. With exactly
 *      one account the current single-dashboard shape is preserved (labeled
 *      via an Account bullet). With multiple accounts each section carries a
 *      `## <provider-id>` heading.
 *   3. Isolation: one account's API failure renders as a loud error section
 *      naming that provider id and the failure; the other account's section
 *      still renders. No silent skips.
 *   4. Masking: keys never appear in output; masked first4/last4 forms do.
 *
 * Hermeticity pattern (established in provider-id-resolution.test.ts and
 * markdown-output.test.ts): credential-gate tests swap HOME to a temp dir
 * holding a fabricated auth.json and mock global.Date to abort each account's
 * query at getTimeWindow() BEFORE any network request; dashboard tests mock
 * https.request. All keys used here are fabricated; none are real.
 */

import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import { EventEmitter } from 'node:events';
import type { RequestOptions } from 'node:https';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import glmQuotaPlugin from '../../src/index.js';

const require = createRequire(import.meta.url);
const https = require('node:https') as typeof import('node:https');
const fs = require('node:fs') as typeof import('node:fs');
const os = require('node:os') as typeof import('node:os');
const path = require('node:path') as typeof import('node:path');

type ToolExecutor = {
  execute: (args?: Record<string, unknown>, context?: Record<string, unknown>) => Promise<string> | string;
};

// Fabricated keys: first4/last4 are distinct so masked forms are assertable.
const BRIM_KEY = 'brim0fake0000key9999zzzz';
const BRIM_MASK = 'brim...zzzz';
const ACCORDION_KEY = 'acco0fake0000key9999yyyy';
const ACCORDION_MASK = 'acco...yyyy';

const ENV_KEYS = ['ZAI_API_KEY', 'ZHIPU_API_KEY', 'ZHIPUAI_API_KEY'];

/** Silenced env-var fallbacks + HOME pointed at a temp auth.json. */
function stageAuth(entries: Record<string, unknown>): () => void {
  const savedEnv: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'glm-quota-multi-'));
  const authDir = path.join(tempHome, '.local', 'share', 'opencode');
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(path.join(authDir, 'auth.json'), JSON.stringify(entries));

  const originalHome = process.env.HOME;
  process.env.HOME = tempHome;

  return () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  };
}

/** Swap global.Date for a throwing subclass (aborts each account at getTimeWindow). */
function stageThrowingDate(): () => void {
  const originalDate = global.Date;

  class ThrowingDate extends Date {
    constructor(...args: ConstructorParameters<typeof Date>) {
      super(...args);
      throw new Error('Date failure');
    }
  }

  global.Date = ThrowingDate as DateConstructor;
  return () => {
    global.Date = originalDate;
  };
}

/** Run the V1 tool entrypoint against a temp auth.json with a throwing Date. */
async function runWithCredentialGate(entries: Record<string, unknown>): Promise<string> {
  const cleanupAuth = stageAuth(entries);
  const cleanupDate = stageThrowingDate();
  try {
    const plugin = await glmQuotaPlugin.server();
    return await (plugin.tool!.glm_quota as unknown as ToolExecutor).execute();
  } finally {
    cleanupDate();
    cleanupAuth();
  }
}

// https.request mock routing (markdown-output.test.ts pattern, extended with
// per-token routes so two accounts can receive different API responses).

type MockRoute = {
  pathPart: string;
  statusCode: number;
  body: Record<string, unknown>;
  /** When set, the route only matches requests carrying this Authorization. */
  token?: string;
};

function createRoutedMockRequest(routes: MockRoute[]) {
  return (
    options: RequestOptions,
    callback: (response: EventEmitter & { statusCode?: number }) => void
  ): EventEmitter & { destroy: () => void; end: () => void; setTimeout: () => unknown } => {
    const request = new EventEmitter() as EventEmitter & {
      destroy: () => void;
      end: () => void;
      setTimeout: () => unknown;
    };

    const requestPath = options.path ?? '';
    const authToken = (options.headers as Record<string, string> | undefined)?.Authorization;
    const route = routes.find(
      (candidate) =>
        requestPath.includes(candidate.pathPart) &&
        (candidate.token === undefined || candidate.token === authToken)
    );
    const mockResponse = route ?? { pathPart: '', statusCode: 404, body: { error: 'not found' } };

    request.destroy = () => {};
    request.setTimeout = () => request;
    request.end = () => {
      queueMicrotask(() => {
        const response = new EventEmitter() as EventEmitter & { statusCode?: number };
        response.statusCode = mockResponse.statusCode;
        callback(response);

        queueMicrotask(() => {
          response.emit('data', JSON.stringify(mockResponse.body));
          response.emit('end');
        });
      });
    };

    return request;
  };
}

function quotaBody(percentage: number): Record<string, unknown> {
  return {
    data: {
      level: 'pro',
      limits: [
        {
          type: 'TOKENS_LIMIT',
          unit: 3,
          number: 5,
          percentage,
          nextResetTime: Date.now() + 3 * 60 * 60 * 1000
        }
      ]
    }
  };
}

function usageBodies(totalTokensUsage: number): MockRoute[] {
  return [
    {
      pathPart: '/model-usage',
      statusCode: 200,
      body: { data: { totalUsage: { totalModelCallCount: 12, totalTokensUsage } } }
    },
    {
      pathPart: '/tool-usage',
      statusCode: 200,
      body: { data: { totalUsage: { totalNetworkSearchCount: 1, totalWebReadMcpCount: 2 } } }
    }
  ];
}

async function runWithMockedHttps(
  entries: Record<string, unknown>,
  routes: MockRoute[],
  run: (execute: () => Promise<string>) => Promise<void>
): Promise<void> {
  const cleanupAuth = stageAuth(entries);
  const originalRequest = https.request;
  https.request = createRoutedMockRequest(routes) as typeof https.request;
  syncBuiltinESMExports();

  try {
    const plugin = await glmQuotaPlugin.server();
    await run(() => (plugin.tool!.glm_quota as unknown as ToolExecutor).execute());
  } finally {
    https.request = originalRequest;
    syncBuiltinESMExports();
    cleanupAuth();
  }
}

describe('Integration: multi-account zai-max discovery and rendering', () => {
  describe('credential discovery', () => {
    test('discovers every zai-max prefixed entry and renders one labeled section per account', async () => {
      const result = await runWithCredentialGate({
        'zai-max-brim': { type: 'api', key: BRIM_KEY },
        'zai-max-accordion': { type: 'api', key: ACCORDION_KEY }
      });

      assert.ok(result.includes('## zai-max-brim'), `missing brim label: ${result}`);
      assert.ok(result.includes('## zai-max-accordion'), `missing accordion label: ${result}`);
      assert.ok(
        (result.match(/Date failure/g) ?? []).length === 2,
        `each discovered account must query independently; got: ${result}`
      );
      assert.ok(!result.includes('Credentials Not Found'), `accounts must resolve: ${result}`);
    });

    test('prefix matching covers the legacy zai-max id', async () => {
      const result = await runWithCredentialGate({
        'zai-max': { type: 'api', key: BRIM_KEY }
      });

      assert.ok(!result.includes('Credentials Not Found'), `legacy zai-max must resolve: ${result}`);
      assert.ok(result.includes('Date failure'), `must pass the credential gate: ${result}`);
    });

    test('legacy exact provider ids still resolve', async () => {
      const result = await runWithCredentialGate({
        'zai-coding-plan': { type: 'api', key: BRIM_KEY }
      });

      assert.ok(!result.includes('Credentials Not Found'), `legacy id must resolve: ${result}`);
      assert.ok(result.includes('Date failure'), `must pass the credential gate: ${result}`);
    });

    test('zero matching entries yields the loud Credentials Not Found outcome', async () => {
      const result = await runWithCredentialGate({
        'totally-unknown-provider': { type: 'api', key: BRIM_KEY }
      });

      assert.ok(result.includes('Credentials Not Found'), `unknown ids must hit the gate: ${result}`);
    });
  });

  describe('section rendering', () => {
    test('a single account keeps the current dashboard shape, labeled via Account bullet', async () => {
      await runWithMockedHttps(
        { 'zai-max-brim': { type: 'api', key: BRIM_KEY } },
        [{ pathPart: '/quota/limit', statusCode: 200, body: quotaBody(40.5) }, ...usageBodies(12500000)],
        async (execute) => {
          const result = await execute();

          assert.ok(result.startsWith('### 📊 '), `single account keeps dashboard-first shape: ${result}`);
          assert.ok(result.includes('### 📊 Z.ai GLM Coding Plan'), `dashboard title renders: ${result}`);
          assert.ok(result.includes('- **Account**: zai-max-brim'), `account bullet labels it: ${result}`);
          assert.ok(result.includes('| ⏱️ 5h Token | 40.5% |'), `quota data renders: ${result}`);
          assert.ok(
            !result.includes('## zai-max-brim'),
            `single-account shape must not gain a wrapper heading: ${result}`
          );
        }
      );
    });

    test('two accounts each render their own labeled dashboard from their own key', async () => {
      await runWithMockedHttps(
        {
          'zai-max-brim': { type: 'api', key: BRIM_KEY },
          'zai-max-accordion': { type: 'api', key: ACCORDION_KEY }
        },
        [
          { pathPart: '/quota/limit', token: BRIM_KEY, statusCode: 200, body: quotaBody(40.5) },
          { pathPart: '/quota/limit', token: ACCORDION_KEY, statusCode: 200, body: quotaBody(77.7) },
          ...usageBodies(12500000)
        ],
        async (execute) => {
          const result = await execute();

          const brimSection = result.split('## zai-max-accordion')[0];
          const accordionSection = result.split('## zai-max-accordion')[1] ?? '';

          assert.ok(result.includes('## zai-max-brim'), `brim section label missing: ${result}`);
          assert.ok(result.includes('## zai-max-accordion'), `accordion section label missing: ${result}`);

          assert.ok(brimSection.includes('- **Account**: zai-max-brim'), `brim bullet missing: ${result}`);
          assert.ok(brimSection.includes('| ⏱️ 5h Token | 40.5% |'), `brim quota data missing: ${result}`);

          assert.ok(
            accordionSection.includes('- **Account**: zai-max-accordion'),
            `accordion bullet missing: ${result}`
          );
          assert.ok(
            accordionSection.includes('| ⏱️ 5h Token | 77.7% |'),
            `accordion must show ITS OWN quota, not the other account's: ${result}`
          );
          assert.ok(
            !accordionSection.includes('40.5%'),
            `accordion section must not contain brim data: ${result}`
          );
        }
      );
    });
  });

  describe('per-account failure isolation and key masking', () => {
    test('one account failing all endpoints leaves a loud error section; the other still renders', async () => {
      await runWithMockedHttps(
        {
          'zai-max-brim': { type: 'api', key: BRIM_KEY },
          'zai-max-accordion': { type: 'api', key: ACCORDION_KEY }
        },
        [
          { pathPart: '/quota/limit', token: BRIM_KEY, statusCode: 200, body: quotaBody(40.5) },
          { pathPart: '/model-usage', token: BRIM_KEY, statusCode: 200, body: { data: { totalUsage: { totalTokensUsage: 12500000 } } } },
          { pathPart: '/tool-usage', token: BRIM_KEY, statusCode: 200, body: { data: { totalUsage: { totalNetworkSearchCount: 1 } } } },
          { pathPart: '/quota/limit', token: ACCORDION_KEY, statusCode: 401, body: { error: 'Unauthorized' } },
          { pathPart: '/model-usage', token: ACCORDION_KEY, statusCode: 401, body: { error: 'Unauthorized' } },
          { pathPart: '/tool-usage', token: ACCORDION_KEY, statusCode: 401, body: { error: 'Unauthorized' } }
        ],
        async (execute) => {
          const result = await execute();

          const brimSection = result.split('## zai-max-accordion')[0];
          const accordionSection = result.split('## zai-max-accordion')[1] ?? '';

          assert.ok(
            accordionSection.includes('### ⚠️ Account Query Failed: zai-max-accordion'),
            `failing account must get a loud labeled error: ${result}`
          );
          assert.ok(
            accordionSection.includes('Authentication Failed'),
            `failure reason must be named: ${result}`
          );
          assert.ok(
            brimSection.includes('| ⏱️ 5h Token | 40.5% |'),
            `healthy account's dashboard must still render: ${result}`
          );
          assert.ok(
            !brimSection.includes('Account Query Failed'),
            `isolation: healthy section must stay clean: ${result}`
          );
        }
      );
    });

    test('keys are masked to first4/last4 and never printed raw', async () => {
      await runWithMockedHttps(
        {
          'zai-max-brim': { type: 'api', key: BRIM_KEY },
          'zai-max-accordion': { type: 'api', key: ACCORDION_KEY }
        },
        [
          { pathPart: '/quota/limit', token: BRIM_KEY, statusCode: 200, body: quotaBody(40.5) },
          { pathPart: '/model-usage', token: BRIM_KEY, statusCode: 200, body: { data: { totalUsage: { totalTokensUsage: 12500000 } } } },
          { pathPart: '/tool-usage', token: BRIM_KEY, statusCode: 200, body: { data: { totalUsage: { totalNetworkSearchCount: 1 } } } },
          { pathPart: '/quota/limit', token: ACCORDION_KEY, statusCode: 401, body: { error: 'Unauthorized' } },
          { pathPart: '/model-usage', token: ACCORDION_KEY, statusCode: 401, body: { error: 'Unauthorized' } },
          { pathPart: '/tool-usage', token: ACCORDION_KEY, statusCode: 401, body: { error: 'Unauthorized' } }
        ],
        async (execute) => {
          const result = await execute();

          assert.ok(!result.includes(BRIM_KEY), `raw brim key leaked: ${result}`);
          assert.ok(!result.includes(ACCORDION_KEY), `raw accordion key leaked: ${result}`);
          assert.ok(
            result.includes(`- **Key**: ${ACCORDION_MASK}`),
            `failing section identifies its credential via masked key: ${result}`
          );
        }
      );
    });
  });
});
