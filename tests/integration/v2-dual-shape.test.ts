import { describe, test } from 'node:test'
import * as assert from 'node:assert'
import { EventEmitter } from 'node:events'
import type { RequestOptions } from 'node:https'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import glmQuotaPlugin from '../../src/index.js'

const require = createRequire(import.meta.url)
const https = require('node:https') as typeof import('node:https')
const fs = require('node:fs') as typeof import('node:fs')

// The upstream V1 tool description; both shapes must register the same string.
const EXPECTED_DESCRIPTION =
  'Query Z.ai GLM Coding Plan usage statistics including quota limits, model usage, and MCP tool usage'

// The frozen migration guide's empty-args JSON Schema (audit 2.3).
const EXPECTED_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false
}

type V2ToolDefinition = {
  name: string
  description: string
  input: Record<string, unknown>
  execute: (input?: Record<string, unknown>) => Promise<{ content: string }>
}

type CapturedEditor = {
  added: V2ToolDefinition[]
  add: (definition: V2ToolDefinition) => void
}

function createCapturingContext() {
  const editor: CapturedEditor = {
    added: [],
    add(definition: V2ToolDefinition) {
      editor.added.push(definition)
    }
  }
  const transformCalls: Array<(cbEditor: CapturedEditor) => void> = []
  const ctx = {
    tool: {
      transform: async (callback: (cbEditor: CapturedEditor) => void) => {
        transformCalls.push(callback)
        callback(editor)
      }
    }
  }
  return { ctx, editor, transformCalls }
}

type MockResponse = {
  statusCode: number
  body: Record<string, unknown>
}

type MockRequest = EventEmitter & {
  destroy: () => void
  end: () => void
  setTimeout: (_timeout: number) => MockRequest
}

function createMockRequest(responses: Record<string, MockResponse>) {
  return (
    options: RequestOptions,
    callback: (response: EventEmitter & { statusCode?: number }) => void
  ): MockRequest => {
    const request = new EventEmitter() as MockRequest
    const path = options.path ?? ''
    const matchedKey = Object.keys(responses).find((key) => path.includes(key))
    const mockResponse = matchedKey
      ? responses[matchedKey]
      : { statusCode: 404, body: { error: 'not found' } }

    request.destroy = () => {}
    request.setTimeout = () => request
    request.end = () => {
      queueMicrotask(() => {
        const response = new EventEmitter() as EventEmitter & { statusCode?: number }
        response.statusCode = mockResponse.statusCode
        callback(response)

        queueMicrotask(() => {
          response.emit('data', JSON.stringify(mockResponse.body))
          response.emit('end')
        })
      })
    }

    return request
  }
}

function mockHttpsResponses(responses: Record<string, MockResponse>) {
  const originalRequest = https.request
  https.request = createMockRequest(responses) as typeof https.request
  syncBuiltinESMExports()
  return () => {
    https.request = originalRequest
    syncBuiltinESMExports()
  }
}

const SUCCESS_RESPONSES: Record<string, MockResponse> = {
  '/quota/limit': {
    statusCode: 200,
    body: {
      data: {
        level: 'pro',
        limits: [
          {
            type: 'TOKENS_LIMIT',
            unit: 3,
            number: 5,
            percentage: 40.5,
            nextResetTime: Date.now() + 3 * 60 * 60 * 1000
          }
        ]
      }
    }
  },
  '/model-usage': {
    statusCode: 200,
    body: {
      data: {
        totalUsage: { totalModelCallCount: 1234, totalTokensUsage: 12500000 }
      }
    }
  },
  '/tool-usage': {
    statusCode: 200,
    body: {
      data: {
        totalUsage: { totalNetworkSearchCount: 5678, totalWebReadMcpCount: 2345 }
      }
    }
  }
}

async function withEnvToken<T>(fn: () => Promise<T>): Promise<T> {
  process.env.ZAI_API_KEY = 'test-token'
  try {
    return await fn()
  } finally {
    delete process.env.ZAI_API_KEY
  }
}

async function withoutCredentials<T>(fn: () => Promise<T>): Promise<T> {
  const originalExistsSync = fs.existsSync
  fs.existsSync = (() => false) as typeof fs.existsSync
  syncBuiltinESMExports()
  const envKeys = ['ZAI_API_KEY', 'ZHIPU_API_KEY', 'ZHIPUAI_API_KEY']
  const savedEnv = envKeys.map((key) => process.env[key])
  envKeys.forEach((key) => delete process.env[key])

  try {
    return await fn()
  } finally {
    fs.existsSync = originalExistsSync
    syncBuiltinESMExports()
    envKeys.forEach((key, index) => {
      if (savedEnv[index] !== undefined) process.env[key] = savedEnv[index] as string
    })
  }
}

describe('V2 dual-shape plugin export', () => {
  test('exports id, setup function, and server function (dual-shape)', () => {
    assert.strictEqual(typeof glmQuotaPlugin.setup, 'function', 'setup must be a function (V2 entrypoint)')
    assert.strictEqual(typeof glmQuotaPlugin.server, 'function', 'server must be a function (V1 entrypoint)')
    assert.strictEqual(glmQuotaPlugin.id, 'opencode-glm-quota')
  })

  test('registers the glm_quota tool via ctx.tool.transform with the empty-args JSON Schema', async () => {
    const { ctx, editor, transformCalls } = createCapturingContext()

    await glmQuotaPlugin.setup(ctx)

    assert.strictEqual(transformCalls.length, 1, 'ctx.tool.transform should be called exactly once')
    assert.strictEqual(typeof transformCalls[0], 'function', 'transform should receive a synchronous editor callback')
    assert.strictEqual(editor.added.length, 1, 'editor.add should be called exactly once')

    const definition = editor.added[0]
    assert.strictEqual(definition.name, 'glm_quota')
    assert.strictEqual(definition.description, EXPECTED_DESCRIPTION)
    assert.deepStrictEqual(definition.input, EXPECTED_INPUT_SCHEMA)
  })

  test('V2 execute returns structured { content } with the quota summary on success', async () => {
    const { ctx, editor } = createCapturingContext()
    await glmQuotaPlugin.setup(ctx)

    await withEnvToken(async () => {
      const restore = mockHttpsResponses(SUCCESS_RESPONSES)
      try {
        const result = await editor.added[0].execute({})

        assert.strictEqual(typeof result, 'object', 'execute must return a structured object (V2 shape)')
        assert.strictEqual(typeof result.content, 'string', 'execute must return { content: string }')
        assert.ok(result.content.includes('### 📊 Z.ai GLM Coding Plan — Pro'))
        assert.ok(result.content.includes('- **Platform**: Z.AI'))
        assert.ok(result.content.includes('| ⏱️ 5h Token | 40.5% |'))
      } finally {
        restore()
      }
    })
  })

  test('V2 execute degrades API auth failures to structured content without throwing', async () => {
    // V1-parity contract: queryAllUsage catches per-endpoint errors (including
    // 401) and renders the report shell — execute must never throw at the host.
    // The loud auth-path failure (no credentials at all) is covered below.
    const { ctx, editor } = createCapturingContext()
    await glmQuotaPlugin.setup(ctx)

    await withEnvToken(async () => {
      const restore = mockHttpsResponses({
        '/quota/limit': { statusCode: 401, body: { error: 'Unauthorized' } },
        '/model-usage': { statusCode: 401, body: { error: 'Unauthorized' } },
        '/tool-usage': { statusCode: 401, body: { error: 'Unauthorized' } }
      })
      try {
        const result = await editor.added[0].execute({})

        assert.strictEqual(typeof result, 'object', 'execute must still return structured content on failure')
        assert.strictEqual(typeof result.content, 'string')
        assert.ok(result.content.includes('### 📊 Z.ai GLM Coding Plan'))
        assert.ok(result.content.includes('No quota data available'))
      } finally {
        restore()
      }
    })
  })

  test('V2 execute surfaces missing credentials loudly as { content } error markdown', async () => {
    const { ctx, editor } = createCapturingContext()
    await glmQuotaPlugin.setup(ctx)

    await withoutCredentials(async () => {
      const result = await editor.added[0].execute({})

      assert.strictEqual(typeof result, 'object', 'execute must still return structured content')
      assert.ok(result.content.startsWith('### ⚠️ Credentials Not Found'))
      assert.ok(result.content.includes('Please authenticate first'))
    })
  })

  test('V1 server() returns the same glm_quota tool definition (byte-compatible hooks)', async () => {
    const hooks = await glmQuotaPlugin.server()
    const tool = hooks.tool?.glm_quota

    assert.ok(tool, 'server() must return the glm_quota tool entry')
    assert.strictEqual(tool.description, EXPECTED_DESCRIPTION)
    assert.deepStrictEqual(tool.args, {})
    assert.strictEqual(typeof tool.execute, 'function')
  })
})
