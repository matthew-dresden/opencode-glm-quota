# AGENTS.md
This is an OpenCode plugin project for querying Z.ai GLM Coding Plan usage statistics.

**Current Phase:** Implementation
**Status:** PRD finalized, ready for implementation
**Architecture:** OpenCode Plugin (not standalone CLI script)

This document provides build commands, code style guidelines, and conventions for agentic coding agents working on this OpenCode plugin repository.

## Git Configuration (CRITICAL)

**Before committing or pushing ANY changes**, verify the git author matches the repository owner:

```bash
# Check current author
git config user.name  # MUST be "guyinwonder"
git config user.email # MUST be "227569314+guyinwonder168@users.noreply.github.com"
```

If the author is wrong (e.g., `eddy.wijaya`), set it for this repo:
```bash
git config user.name "guyinwonder"
git config user.email "227569314+guyinwonder168@users.noreply.github.com"
```

**Always verify** with `git log -1 --format='%an <%ae>'` before pushing.

## Build & Development Commands

```bash
# Build TypeScript to JavaScript
npm run build

# Clean build artifacts
npm run clean

# Run all tests
npm run test

# Run specific test file
npm run test -- path/to/test.test.ts

# Watch mode during development (if configured)
npm run test -- --watch

# Lint source code
npm run lint

# Prepare for npm publish
npm run prepublishOnly
```

## GitHub Actions CI/CD

This project uses GitHub Actions for automated CI/CD.

### CI Workflow (Automatic)

**Triggers:**
- Push to `main` branch
- Pull requests to `main` branch

**What It Does:**
- Tests code on multiple Node.js versions (18.x, 20.x, 22.x)
- Runs linting (`npm run lint`)
- Builds TypeScript (`npm run build`)
- Runs all tests (`npm test`)
- Validates documentation links
- Uploads test coverage artifacts

**View Results:**
- Check the "Actions" tab in GitHub repository
- Green checkmark ✅ = All tests passed
- Red X ❌ = Something failed (check logs)

### Publish Workflow (On Release)

**Triggers:**
- GitHub release published

**What It Does:**
- Builds, tests, and lints code
- Publishes package to npm with provenance
- Publishes package to GitHub Packages as scoped package (`@<repo-owner>/opencode-glm-quota`)
- Creates release artifacts

**Setup Required:**
1. Create npm automation token at https://www.npmjs.com/settings/tokens
2. Add `NPM_TOKEN` to GitHub repository secrets:
   - Go to Settings → Secrets and variables → Actions
   - Create secret: `NPM_TOKEN`
   - Value: Your npm automation token

**How to Publish:**
```bash
# Using GitHub CLI
gh release create v1.0.0 --generate-notes

# Or via GitHub web UI:
# 1. Go to Releases → Create new release
# 2. Enter version tag (e.g., v1.0.0)
# 3. Add release notes
# 4. Click "Publish release"
```

The workflow automatically publishes to npm and GitHub Packages when a release is created.

### CI Status Badge

The README includes a CI status badge that shows the current build status:
```
[![Build Status](https://github.com/guyinwonder168/opencode-glm-quota/workflows/CI/badge.svg)]
```

This badge updates automatically with each commit.

## Project Structure

```
src/
  index.ts           # Main plugin entry point
  api/
    client.ts        # HTTPS client with timeout and error handling
    endpoints.ts     # Platform-specific API endpoints
    platforms.ts     # Platform detection and naming
  utils/
    date-formatter.ts # Date/time formatting utilities
    progress-bar.ts   # ASCII progress bar rendering
    time-window.ts    # Rolling window calculation
  dist/                             # Compiled JavaScript (generated)
  tests/                            # Test suite
  package.json                       # Dependencies and scripts
  tsconfig.json                      # TypeScript configuration
```

## Code Style Guidelines

### TypeScript Configuration
- Target: ES2022
- Module: NodeNext
- Strict mode enabled
- Always use type annotations for function returns
- Use `as const` for constants that shouldn't be modified

### Import Order
1. Core Node.js modules (`fs`, `path`, `os`, `https`)
2. Third-party imports (none — the plugin is dependency-free at runtime)
3. Local imports (if any)
4. Type imports (use `import type` where possible)

```typescript
// ✅ Correct
import * as fs from "fs"
import * as path from "path"
import type { Platform } from "./api/platforms.js"
```

### Naming Conventions
- **Constants**: `UPPER_SNAKE_CASE` for immutable constants
- **Functions**: `camelCase` for regular functions
- **Types/Interfaces**: `PascalCase` (e.g., `ApiResponse`, `Credentials`)
- **Interfaces**: Describe data structures; use for object shapes
- **Type Aliases**: Use for unions, literals, or primitives

```typescript
const ENDPOINTS = { /* ... */ }  // UPPER_SNAKE_CASE
function getCredentials() { }     // camelCase
interface ApiResponse { }         // PascalCase
type Platform = 'ZAI' | 'ZHIPU'   // PascalCase for union types
```

### Error Handling
- Always wrap file operations in try-catch blocks
- Use `null` returns for optional values, not errors
- Include fallback mechanisms (e.g., auth.json → env vars)
- Return user-friendly error messages with setup instructions

```typescript
async function getCredentials(): Promise<Credentials | null> {
  try {
    // Primary method
  } catch {
    // Silent fail, try next method
  }
  // Fallback methods
  return null  // No credentials found
}
```

### API & HTTP Requests
- Use native `https` module (no fetch for Node.js compatibility)
- **CRITICAL**: Do NOT use "Bearer" prefix in Authorization header
- Always validate response status code before processing
- URL-encode query parameters using `encodeURIComponent()`
- Set proper headers: `Authorization`, `Accept-Language`, `Content-Type`

```typescript
headers: {
  'Authorization': authToken,  // NO "Bearer" prefix
  'Accept-Language': 'en-US,en',
  'Content-Type': 'application/json'
}
```

### Date & Time Formatting
- Format: `yyyy-MM-dd HH:mm:ss` (24-hour format)
- Use `padStart(2, '0')` for zero-padded numbers
- Time window: Yesterday at current hour → Today at current hour end

```typescript
function formatDateTime(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  // ... etc
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}
```

### Output Formatting
- Use ASCII box-drawing characters (`╔`, `╠`, `║`, `╚`) for tables
- Pad strings to fixed width: `text.padEnd(width)`
- Progress bars: `#` for filled, `-` for empty (ASCII to avoid terminal double-width issues)
- Truncate long output with ellipsis `...`
- **CRITICAL**: Always use `BOX_WIDTH` constants from `src/utils/box-constants.ts` instead of hardcoding dimensions:
  - `BOX_WIDTH.TOTAL` (60) - Total line width
  - `BOX_WIDTH.CONTENT` (56) - Available content width
  - `BOX_WIDTH.BORDER_CHARS` (58) - Border character count
  - `BOX_WIDTH.PADDING` (2) - Left/right padding
- Import in tests: `import { BOX_WIDTH } from '../../src/utils/box-constants.js'`

```typescript
// ❌ WRONG - Hardcoded dimensions
assert.strictEqual(lines[0].length, 60);
const contentWidth = 56;

// ✅ CORRECT - Use constants
import { BOX_WIDTH } from '../../src/utils/box-constants.js';
assert.strictEqual(lines[0].length, BOX_WIDTH.TOTAL);
const contentWidth = BOX_WIDTH.CONTENT;
```

### Comments & Documentation
- Use JSDoc-style comments for exported functions
- Inline comments only for non-obvious logic
- Mark sections with separator comments for readability

```typescript
/**
 * Get credentials with priority order
 * 1. OpenCode auth.json
 * 2. Environment variables
 * 3. Legacy Claude Code variables
 */
async function getCredentials(): Promise<Credentials | null> { }
```

### Development Principles

**CRITICAL:** Implementation MUST follow these principles to avoid over-engineering and maintain simplicity. Violating any of them is a blocking issue — stop and simplify before proceeding.

**No Over-Thinking (Primary Rule):**
- Do NOT deliberate extensively on simple tasks — act decisively
- Do NOT speculate about future needs — solve the problem in front of you
- Do NOT create design documents for single-function changes
- Do NOT weigh alternatives for more than a few minutes — pick the simplest viable option and implement
- If a senior engineer would say "just do it", then just do it
- Over-thinking wastes time; over-engineering wastes code. Both are blockers.

**KISS (Keep It Simple, Stupid):**
- Simplest correct solution wins. Always.
- Prefer plain functions over classes, factories, or patterns
- Prefer constants over config objects
- Prefer inline code over abstractions for single-use cases
- If code needs a 5-line comment to explain WHY it exists, it's too complex
- Fewer lines of code = fewer bugs = easier review

**YAGNI (You Aren't Gonna Need It):**
- Build only what's needed NOW, not what you might need LATER
- Don't create abstractions without multiple implementations
- Don't optimize prematurely (measure first, then optimize)
- Don't add features not in PRD

**TypeScript Best Practices:**
- Use `unknown` instead of `any` when possible
- Prefer `type` over `interface` for simple shapes
- Use `as const` for literal types to avoid widening
- Use discriminated unions instead of optional properties where appropriate
- Let TypeScript infer types when possible (don't over-annotate)

**Avoid Over-Engineering:**
- Don't create factory patterns when simple functions work
- Don't build generic HTTP client when you only need one endpoint
- Don't add validation libraries for simple type checks
- Don't create config objects when constants work
- Don't abstract every possible future use case

**When to Build Abstractions:**
- ✅ Multiple implementations exist (platform detection, auth methods)
- ✅ Code is duplicated 3+ times
- ✅ Tests reveal the abstraction is needed
- ❌ "Might need this later" - NOT a valid reason
- ❌ "More flexible" - Flexibility without actual need = complexity

**Examples: What to AVOID:**

```typescript
// ❌ OVER-ENGINEERED: Generic HTTP client for 1 endpoint
class HttpClient {
  private baseURL: string;
  private headers: Record<string, string>;
  constructor(baseURL: string, headers: Record<string, string>) {
    this.baseURL = baseURL;
    this.headers = headers;
  }
  async get(path: string, params?: Record<string, string>) {
    // 100 lines of generic implementation
  }
  async post(path: string, body: any) {
    // Not needed for this project
  }
  async put() { /* Not needed */ }
  async delete() { /* Not needed */ }
}

// ✅ SIMPLE: Just make the one request we need
async function makeRequest(url: string, token: string): Promise<ApiResponse> {
  const data = await httpsRequest(url, token);
  return JSON.parse(data);
}

// ❌ OVER-ENGINEERED: Factory pattern for 1 function
class EndpointFactory {
  static create(type: 'quota' | 'model' | 'tool'): Endpoint {
    switch(type) {
      case 'quota': return new QuotaEndpoint();
      case 'model': return new ModelEndpoint();
      case 'tool': return new ToolEndpoint();
    }
  }
}

// ✅ SIMPLE: Just use the endpoints directly
const ENDPOINTS = {
  quota: '/api/monitor/usage/quota/limit',
  model: '/api/monitor/usage/model-usage',
  tool: '/api/monitor/usage/tool-usage'
} as const;

// ❌ OVER-ENGINEERED: Generic validation library
function createValidator<T>(schema: Schema<T>) {
  return (data: unknown): ValidationResult<T> => {
    // 200 lines of generic validation logic
  };
}

// ✅ SIMPLE: Type guards for what we actually need
function isApiResponse(data: unknown): data is ApiResponse {
  return typeof data === 'object' && 'TOKENS_LIMIT' in data;
}
```

**Simple is Better Than Flexible:**
- Simple code is easier to test
- Simple code is easier to debug
- Simple code is easier to maintain
- Flexible without requirements = complex for no reason

**TDD (Test-Driven Development) — MANDATORY for all code changes:**

Workflow (Red → Green → Refactor):
1. **RED**: Write a failing test that describes the desired behavior BEFORE any implementation
2. **GREEN**: Write the minimum code to make the test pass — nothing more
3. **REFACTOR**: Improve code quality while keeping tests green

Rules:
- ❌ NEVER write implementation before tests
- ❌ NEVER add code without a corresponding test
- ✅ One test at a time — write, run, repeat
- ✅ Tests define the spec; implementation satisfies it
- ✅ If a bug is found, write a test that reproduces it FIRST, then fix
- ✅ Commit only when all tests pass

```bash
# TDD cycle commands
npm run test -- path/to/test.test.ts   # Run specific test (RED check)
npm run test                            # Run all tests (GREEN verification)
npm run build                           # Ensure compiles
```

**Reference:**
- Implementation plan: `docs/implementation-plan.md` - Follows TDD with vertical slicing
- ALL context needed for OpenAgents: `/home/eddy/distrobox/box-go-debian-home/.config/opencode/context/` - find the needed context here if you didnt found it in the project folder
- Code standards: `/home/eddy/distrobox/box-go-debian-home/.config/opencode/context/core/standards/code.md` - Detailed principles above

### Plugin Architecture (Dual-Shape Plugin)

**Export Structure** (v2 port, "Support V1 and V2 from one package"):

```typescript
// No @opencode-ai/plugin import — the package is dependency-free at runtime.
// The plain object matches the v2 Plugin.define output shape.

async function server() {
  return {
    tool: {
      glm_quota: {
        description: 'Query Z.ai GLM Coding Plan usage statistics...',
        args: {},
        async execute() {
          // shared quota-fetch logic; returns Markdown string
        }
      }
    }
  }
}

async function setup(ctx) {
  await ctx.tool.transform((editor) => {
    editor.add({
      name: 'glm_quota',
      description: 'Query Z.ai GLM Coding Plan usage statistics...',
      input: { type: 'object', properties: {}, additionalProperties: false },
      async execute() {
        const content = await serverToolBody(); // same shared logic
        return { content };
      }
    })
  })
}

export default { id: 'opencode-glm-quota', setup, server }
```

- v1 hosts (>= 1.18.29) call `server()`; v2 hosts call `setup()`.
- Both registrations share ONE quota-fetch implementation — never duplicate it.
- The v2 tool uses a JSON Schema `input` and returns structured `{ content }`.

### Dual-Shape Export Rules

**CRITICAL: one default export, nothing else**

Both host generations resolve the plugin from the module's default export —
the dual-shape object `{ id, setup, server }`:

- v1 hosts (>= 1.18.29) accept the object entrypoint and call `server()`;
  the legacy loader iterated every module export, so the module exports ONLY
  the default object (no named exports).
- v2 hosts read the default definition and call `setup()`; the `id` field
  scopes plugin storage and diagnostics.

Rules:

1. **No named exports from `src/index.ts`** — no plugin factory, no helpers,
   no types. All helpers stay module-internal.
2. **No `@opencode-ai/plugin` / `@opencode/plugin` imports** — the package is
   dependency-free at runtime. The v1 `tool()` helper was an identity
   function, so hosts receive the plain definition object unchanged.
3. **One quota-fetch implementation** — both `server()` and `setup()`
   registrations share the same internal `runQuotaQuery()`.
4. **Guarded execute paths** (amendment 9 discipline): non-essential failures
   are caught and returned as Markdown error content, never thrown at the
   host; the missing-credentials outcome is the loud "Credentials Not Found"
   error content with setup instructions.

## Testing
- Write tests in TypeScript with `.test.ts` extension
- Use Node.js built-in test runner (`node --test`)
- Mock file system and HTTP requests in tests
- Test error paths (missing credentials, API failures, timeout, parse errors)
- **No retry logic tests** - Plugin uses fail-fast philosophy (user-requested)

**Test Categories:**
1. **Functional tests** - Pure functions (formatDateTime, getTimeWindow, processQuotaLimit, createProgressBar)
2. **Module tests** - With mocks (getCredentials, platform mapping, makeRequest)
3. **Integration tests** - End-to-end credential → API → output flow
4. **Error handling tests** - Network, auth, API, parse errors (NO retry logic)
5. **Security tests** - Token masking, file permission validation, error sanitization

## Platform Detection
- **Provider ID determines platform**: OpenCode's authentication system provides provider ID (`zai-coding-plan`, `zai`, `zhipu`)
- **Endpoints**: Three separate monitoring endpoints per platform (verified from `docs/query-usage.mjs`)
- **Supported platforms**:
  - ZAI (api.z.ai) - Global platform
  - ZHIPU (open.bigmodel.cn, dev.bigmodel.cn) - CN platform
- **No URL parsing**: Plugin receives provider ID directly from OpenCode, no URL detection needed

## Authentication & Credential Discovery

**OpenCode Plugin Architecture:**
1. **Primary:** OpenCode auth.json via `/connect` command (automated by OpenCode)
   - Location: `~/.local/share/opencode/auth.json`
   - Provider IDs: `zai-coding-plan`, `zai`, `zhipu`
   - Plugin receives auth context automatically via OpenCode's plugin system

**Environment Variables (Fallback - Development/Testing Only):**
2. `ZAI_API_KEY` - For Z.AI platform
3. `ZHIPU_API_KEY` or `ZHIPUAI_API_KEY` - For ZHIPU platform

**Important:**
- Plugins do NOT read auth.json directly - they receive auth context from OpenCode
- Plugins do NOT handle authentication prompts - OpenCode manages user authentication
- Environment variables are intended for development and testing only
- For production use, always authenticate via OpenCode's `/connect` command

**Documentation:** See CHANGELOG.md for detailed change history and implementation decisions.

## Critical Implementation Details

**API Endpoints** (verified from `docs/query-usage.mjs`):
- `/api/monitor/usage/quota/limit` - Current quotas (no query params)
- `/api/monitor/usage/model-usage` - Model stats (with time range)
- `/api/monitor/usage/tool-usage` - MCP tool usage (with time range)

**Authentication**:
- **Auth Header**: Raw token, NO "Bearer" prefix (CRITICAL)
- **Time Window**: 24-hour rolling window from yesterday at current hour to today at current hour end

**Platform Detection**:
- Provider ID determines platform (ZAI vs ZHIPU)
- No URL parsing needed - plugin receives provider ID from OpenCode context

**Error Handling Philosophy** (based on feedback):
- **No retry logic** - Fail fast on errors, let user retry when ready
- **Sequential requests** - Query endpoints one by one (not parallel)
- **No auth state caching** - Always check auth.json on each call (status checker philosophy)
- **Silent failure logging** - Log auth.json parse errors for debugging

**Security**:
- Token sanitization in all error messages
- File permission validation for auth.json (check for 0600 on Unix)
- No token exposure in logs or errors

## Verification Before Completion

**Local Testing:**
Always run these before pushing:
1. `npm run build` - Ensure TypeScript compiles without errors
2. `npm run lint` - Check for linting issues
3. `npm run test` - Verify all tests pass
4. Manual test: `/glm_quota` command in OpenCode

**CI/CD Verification:**
After pushing, verify GitHub Actions workflow:
5. Check CI workflow runs successfully in GitHub Actions tab
6. Verify all Node.js versions (18, 20, 22) pass tests
7. Confirm documentation validation passes

**Before Publishing:**
Before creating a GitHub release:
8. All CI checks must pass
9. Update version in package.json (if exists)
10. Update CHANGELOG.md with changes
11. Create GitHub release (workflow publishes to npm and GitHub Packages automatically)

## Common Pitfalls
- ❌ Adding "Bearer " prefix to Authorization header
- ❌ Using single fabricated endpoint instead of three actual endpoints
- ❌ Missing URL encoding for query parameters
- ❌ Hardcoding HTTPS port to 443 in tests (use URL port for local test servers)
- ❌ Not handling missing credentials gracefully
- ❌ Forgetting to pad strings in ASCII output
- ❌ Assuming specific auth.json structure (use flexible discovery)

- **Known Issue: HTTPS server binding** - When using `https.createServer()` in tests, binding to `0.0.0.0` causes ECONNREFUSED errors on some systems. **Solution:** Bind to `127.0.0.1` instead of `0.0.0.0`. Also add a short delay (50ms) after `server.listen()` to ensure server is fully initialized before making requests.
