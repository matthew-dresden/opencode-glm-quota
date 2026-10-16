# opencode-glm-quota

## Provenance

- Upstream: https://github.com/guyinwonder168/opencode-glm-quota (MIT, LICENSE file shipped upstream).
- Imported: full git history and all tags through `v1.8.1` (upstream HEAD `f31d4f250c792b293c2a8812955e569efd96277f` at import time), mirrored into this repository.
- This fork is licensed Apache-2.0 (see `LICENSE`); the MIT-licensed upstream code is relicensed with attribution retained in `NOTICE`.
- Fork decision (R17): the `bin/install.js` postinstall and the `integration/` agent/command/skill extras are dropped. The fork ships the self-contained `glm_quota` plugin tool only; nothing executes at npm-install time. Any integration extra worth keeping will be re-registered as a V2-native plugin hook, not an installer.
- Source-review paths (R15): V1 plugin installs live at `~/.cache/opencode/packages/opencode-glm-quota@latest/node_modules/opencode-glm-quota/`; the V2 plugin cache is `~/.cache/opencode/npm/`.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Build Status](https://github.com/matthew-dresden/opencode-glm-quota/actions/workflows/ci.yml/badge.svg)](https://github.com/matthew-dresden/opencode-glm-quota/actions)

OpenCode plugin to query Z.ai GLM Coding Plan usage statistics with real-time quota monitoring, model usage tracking, and MCP tool usage.

## Features

- 📊 Query current quota limits (5-hour token cycle, weekly quota, monthly MCP usage)
- 🤖 View model usage statistics (24-hour rolling window)
- 🔧 View MCP tool usage (web_search, web_reader, etc.)
- 🌍 Supports both Global (api.z.ai) and CN (open.bigmodel.cn) platforms
- 🔐 Automatic credential discovery via OpenCode authentication context
- 📈 Visual progress bars for quota percentages rendered in Markdown code spans
- ⏰ Reset countdown display - Shows when quota resets with local timezone clock time (hours/days + HH:MM)
- 🏷️ Account plan display - Shows your subscription tier (Lite, Pro, etc.)
- ⚡ Fail-fast error handling (no retry logic - user controls when to retry)

## opencode v2 support

This fork ships a **dual-shape** plugin: one default export that works on both
host generations (per the frozen migration guide, "Support V1 and V2 from one
package"):

```js
export default {
  id: "opencode-glm-quota",
  async setup(ctx) { /* V2: ctx.tool.transform registration */ },
  async server() { /* V1: legacy hooks object */ },
}
```

- **opencode v2 hosts** call `setup()`, which registers the `glm_quota` tool
  through `ctx.tool.transform` with a JSON Schema input
  (`{"type":"object","properties":{},"additionalProperties":false}`) and a
  structured `{ content }` return. The plugin id is `opencode-glm-quota`.
- **opencode v1 hosts (>= 1.18.29)** call `server()`, which returns the same
  `glm_quota` tool definition as v1.8.4 (the legacy `tool()` helper was an
  identity function, so the hooks object is unchanged). Older v1 hosts that do
  not understand object entrypoints are not supported.
- The package is **dependency-free at runtime** — it imports neither
  `@opencode-ai/plugin` (v1) nor `@opencode/plugin` (v2).
- **Credential resolution is unchanged in v2**: the tool still discovers
  credentials from OpenCode's `auth.json` candidates
  (`~/.local/share/opencode/auth.json`, plus the legacy Windows fallback), then
  the `ZAI_API_KEY` / `ZHIPU_API_KEY` / `ZHIPUAI_API_KEY` environment
  variables, and queries the Z.ai monitoring endpoints itself.

### Installing under opencode v2

Pin the exact signed tag in your `opencode.jsonc` (git-ref consumption format):

```jsonc
{
  "plugins": [
    "git+https://github.com/matthew-dresden/opencode-glm-quota.git#v2.0.0"
  ]
}
```

Use an exact `vX.Y.Z` tag — mutable refs (branch names, `#main`) are not
supported. Until the fork's first v2 release is cut, no published tag carries
the dual shape.

## Installation

The fork drops the upstream `bin/install.js` installer and the `integration/`
extras (R17 decision) — nothing executes at npm-install time, and there is no
`npx opencode-glm-quota install`. The plugin registers itself with the host on
load; the `/glm_quota` command/agent/skill extras are not shipped.

### Option 1: git-ref pin (opencode v2, recommended)

See ["Installing under opencode v2"](#installing-under-opencode-v2) above.

### Option 2: Local Development

```bash
# Clone and build
git clone https://github.com/matthew-dresden/opencode-glm-quota.git
cd opencode-glm-quota
npm install
npm run compile

# Run the test suite
npm test
```

## Quick Start

Once installed, simply run the plugin command in OpenCode:

```bash
/glm_quota
```

The plugin will automatically detect your credentials (from OpenCode authentication) and display your usage statistics.

## Usage

### Authentication Setup

This plugin uses OpenCode's built-in authentication system. No manual configuration required.

**Primary Method (Recommended):**

```bash
# In OpenCode TUI
/connect
# Select: Z.AI Coding Plan or Z.AI
# Enter your API key
```

**Fallback (Development/Testing Only):**

```bash
# For Global platform (api.z.ai)
export ZAI_API_KEY="your-api-key"

# For CN platform (open.bigmodel.cn)
export ZHIPU_API_KEY="your-api-key"
```

### Running the Plugin

After authentication, simply run:

```bash
/glm_quota
```

### Output Example

```markdown
### 📊 Z.ai GLM Coding Plan — Pro

- **Platform**: Z.AI
- **Period**: 2026-01-17 21:00:00 → 2026-01-18 20:59:59

##### 🪙 Quota Limits

| Window | Usage | Progress | Resets In |
|--------|------:|----------|-----------|
| ⏱️ 5h Token | 40.5% | `█████░░░░░░░` | 3h 42m (01:34) |
| 📅 Weekly | 52.0% | `██████░░░░░░` | 4d 12h (Sat 13:48) |
| 🔌 MCP (1 Month) | 12.3% | `█░░░░░░░░░░░` | — |

##### 📊 Quota Usage

| Metric | Value |
|--------|------:|
| 💰 **Token Used** | **12,500,000 / 40,000,000** |
| 🔌 **MCP Used** | **123 / 1000** |

##### 🔧 MCP Tool Breakdown

| Tool | Count |
|------|------:|
| 🔍 Network Searches | 5,678 |
| 🌐 Web Reads | 2,345 |
| 📖 ZRead Calls | 890 |

##### 🤖 Model Usage (24h)

| Metric | Value |
|--------|------:|
| 🔢 Total Tokens | 12,500,000 (31% of 5h limit) |
| ⏱️ 5h Window | 40.5% of 40,000,000 |
| 📞 Total Calls | 1,234 |

##### 🛠️ Tool Usage (24h)

| Tool | Count |
|------|------:|
| 🔍 Network Searches | 5,678 |
| 🌐 Web Reads | 2,345 |
| 🎭 ZRead Calls | 890 |
```

### Error Handling

The plugin uses fail-fast error handling. If any API request fails, it will display the error and stop (no automatic retries). This gives you full control over when to retry.

**Example Error Output:**

```markdown
### ⚠️ Credentials Not Found

Please authenticate first.

**How to fix:**
1. Run `/connect` command in OpenCode TUI.
2. Select "Z.AI Coding Plan", "Z.AI", or "Zhipu".
3. For development/testing, set `ZAI_API_KEY` or `ZHIPU_API_KEY`.
```

## API Reference

This plugin queries three Z.ai monitoring endpoints:

| Endpoint | Purpose | Query Params |
|----------|---------|--------------|
| `/api/monitor/usage/quota/limit` | Current quota percentages | None |
| `/api/monitor/usage/model-usage` | Model usage (24h window) | `startTime`, `endTime` |
| `/api/monitor/usage/tool-usage` | MCP tool usage (24h window) | `startTime`, `endTime` |

### Platform Detection

The plugin automatically detects the platform based on the provider ID used during authentication:

| Provider ID | Platform | API Base URL |
|-------------|----------|---------------|
| `zai-coding-plan` | ZAI | `https://api.z.ai` |
| `zai` | ZAI | `https://api.z.ai` |
| `zhipu` | ZHIPU | `https://open.bigmodel.cn` |

### Credential Priority

The plugin discovers credentials in this order:

1. **OpenCode authentication context** (managed by OpenCode) - PRIMARY
2. **Environment variable** `ZAI_API_KEY` (Global) or `ZHIPU_API_KEY` (CN) - FALLBACK (dev/testing only)

**Where credentials are read:** OpenCode stores `auth.json` at `~/.local/share/opencode/auth.json` on **all platforms, including Windows**. On Windows the plugin additionally checks the legacy `%LOCALAPPDATA%\opencode\auth.json` location as a fallback, trying the XDG path first so a stale legacy or workaround copy can never override current credentials. Every candidate is probed until one yields a valid key.

### Time Window

Usage statistics are queried for a 24-hour rolling window:
- **Start**: Yesterday at current hour (e.g., 14:00:00)
- **End**: Today at current hour end (e.g., 14:59:59)

### Authentication

**Critical**: The plugin does NOT use "Bearer" prefix in the Authorization header. The token is passed directly:

```http
Authorization: {token}
Accept-Language: en-US,en
Content-Type: application/json
```

## Development

### Build Commands

```bash
# Build TypeScript to JavaScript
npm run compile

# Clean build artifacts
npm run clean

# Run all tests
npm run test

# Run test suite with coverage
npm run test:coverage

# Run specific test file
npm run test -- path/to/test.test.ts

# Watch mode during development
npm run test -- --watch

# Lint source code
npm run lint

# Prepare for npm publish
npm run prepublishOnly
```

### Project Structure

```
src/
  index.ts              # Main plugin entry point
  api/
    client.ts           # HTTPS client with timeout and error handling
    endpoints.ts        # Platform-specific API endpoints
    platforms.ts        # Platform detection and naming
  utils/
    date-formatter.ts   # Date/time formatting utilities
    progress-bar.ts     # ASCII progress bar rendering
    time-window.ts      # Rolling window calculation
dist/                   # Compiled JavaScript (generated)
tests/                  # Test suite
package.json            # Dependencies and scripts
tsconfig.json           # TypeScript configuration
```

### Code Style Guidelines

- Target: ES2022
- Module: NodeNext
- Strict mode enabled
- Always use type annotations for function returns
- Use `as const` for immutable constants

For detailed coding conventions, see [AGENTS.md](AGENTS.md).

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

Apache-2.0 — see [LICENSE](LICENSE). Upstream MIT attribution is retained in
[NOTICE](NOTICE).

## Acknowledgments

- **Adaptation from [zai-org/zai-coding-plugins](https://github.com/zai-org/zai-coding-plugins)** - This plugin is an OpenCode adaptation of the original Z.ai coding plugins repository
- Built for [OpenCode](https://opencode.ai)

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and detailed changes.
