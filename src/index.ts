/**
 * OpenCode GLM Quota Plugin
 * 
 * Query Z.ai GLM Coding Plan usage statistics including quota limits,
 * model usage, and MCP tool usage.
 */

import * as fs from "fs";
import type { Platform } from "./api/platforms.js";
import { detectPlatform, getPlatformName } from "./api/platforms.js";
import { getEndpoints } from "./api/endpoints.js";
import { queryEndpoint } from "./api/client.js";
import type { ApiResponse } from "./api/client.js";
import { getTimeWindow, getTimeWindowQueryParams } from "./utils/time-window.js";
import { getAuthFilePathCandidates } from "./utils/auth-path.js";
import { formatProgressLine } from "./utils/progress-bar.js";
import { maskKey } from "./utils/key-masking.js";
import {
  MAIN_TITLE_PREFIX,
  ROW_EMOJI,
  SECTION_HEADERS
} from "./utils/markdown-constants.js";
import { createMarkdownError } from "./utils/error-formatter.js";
import {
  FIVE_HOUR_TOKEN_LIMIT_LABEL,
  getTokenLimitLabel,
  isFiveHourTokenLimit
} from "./utils/token-limits.js";

// ============================================================================
// CONSTANTS
// ============================================================================

// Legacy provider ids from the upstream plugin era, discovered by EXACT
// auth.json key match (case-sensitive, unchanged behavior).
const EXACT_PROVIDER_IDS = [
  'zai-coding-plan',
  'zai',
  'z-ai',
  'z.ai',
  'zhipu',
  'zhipuai'
] as const;

// The zai-max account family is discovered by PREFIX match: the legacy single
// account `zai-max` plus every renamed or additional host account
// (`zai-max-brim`, `zai-max-accordion`, any future `zai-max-*`). Prefix
// matching keeps discovery working across host config renames without a
// candidate-list bump. detectPlatform() resolves every `zai-max*` id to ZAI
// via its existing lower.includes('zai') logic.
const MULTI_ACCOUNT_PROVIDER_PREFIX = 'zai-max';

const DEFAULT_TOKEN_LIMIT = 40000000;
const MCP_LIMIT_LABEL = 'MCP usage(1 Month)';
const TOKEN_LIMIT_TYPE = 'TOKENS_LIMIT';
const TIME_LIMIT_TYPE = 'TIME_LIMIT';

// ============================================================================
// TYPES
// ============================================================================

/**
 * One discovered credential-bearing account. The providerId is the auth.json
 * key (or the environment variable name for the dev fallback) and doubles as
 * the account section label in the output.
 */
interface DiscoveredAccount {
  providerId: string;
  token: string;
  platform: Platform;
}

/**
 * Quota limit item from API response
 */
interface QuotaLimitItem {
  type: string;
  rawType?: string;
  unit?: number;
  number?: number;
  percentage: number;
  currentValue?: number;
  total?: number;
  usageDetails?: Record<string, unknown>;
  nextResetTime?: number; // Unix timestamp in milliseconds
}

/**
 * Processed quota limit response
 */
interface ProcessedQuotaLimit {
  limits?: QuotaLimitItem[];
  [key: string]: unknown;
}

// ============================================================================
// PLUGIN SHAPE TYPES
// ============================================================================

/**
 * V1 hooks object returned by the `server()` entrypoint (legacy hosts >= 1.18.29
 * call `server()`; the host's plugin loader accepts the tool definition as-is;
 * the old `@opencode-ai/plugin` `tool()` helper was an identity function).
 */
interface V1ToolDefinition {
  description: string;
  args: Record<string, never>;
  execute: () => Promise<string>;
}

interface V1PluginHooks {
  tool: { glm_quota: V1ToolDefinition };
}

/**
 * Minimal structural types for the V2 plugin API (`@opencode/plugin` shape).
 * The default export matches what `Plugin.define` produces without importing it,
 * keeping the package dependency-free (the canary probe proved the plain-object
 * shape passes V2 schema validation).
 */
interface V2ToolDefinition {
  name: string;
  description: string;
  input: {
    type: 'object';
    properties: Record<string, never>;
    additionalProperties: false;
  };
  execute: (input: Record<string, unknown>) => Promise<{ content: string }>;
}

interface V2ToolEditor {
  add: (definition: V2ToolDefinition) => void;
}

interface V2PluginContext {
  tool: {
    transform: (callback: (editor: V2ToolEditor) => void) => Promise<void>;
  };
}

// ============================================================================
// CREDENTIAL DISCOVERY
// ============================================================================

/**
 * Extract API key from auth entry
 * @param entry - Auth entry (string or object)
 * @returns API key or null
 */
function extractKeyFromEntry(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object' && entry !== null) {
    const obj = entry as Record<string, unknown>;
    for (const keyName of ['apiKey', 'api_key', 'token', 'key', 'accessToken', 'auth_token']) {
      if (typeof obj[keyName] === 'string') return obj[keyName] as string;
    }
  }
  return null;
}

/**
 * Check whether an auth.json key belongs to the zai-max account family
 * (prefix match, case-insensitive). Covers the legacy `zai-max` id and the
 * renamed or additional host accounts (`zai-max-brim`, `zai-max-accordion`).
 * @param providerId - The auth.json key under test
 * @returns True when the key belongs to the zai-max family
 */
function isMultiAccountProviderId(providerId: string): boolean {
  return providerId.toLowerCase().startsWith(MULTI_ACCOUNT_PROVIDER_PREFIX);
}

/**
 * Check whether an auth.json key is one of the legacy exact candidate ids.
 * @param providerId - The auth.json key under test
 * @returns True when the key is a legacy exact candidate
 */
function isExactProviderId(providerId: string): boolean {
  return (EXACT_PROVIDER_IDS as readonly string[]).includes(providerId);
}

/**
 * Discover every usable account from OpenCode auth.json or environment
 * variables.
 *
 * Priority 1: auth.json. Every candidate path is probed (legacy LOCALAPPDATA
 * on Windows, then the cross-platform XDG path). Within a file, EVERY entry
 * whose key is a legacy exact id or belongs to the zai-max prefix family
 * becomes an account, so multiple zai-max accounts are discovered
 * side by side. The quota API is queried once per discovered key. Entries
 * with no extractable token are not usable accounts and are skipped.
 *
 * Priority 2: environment variables (development/testing only), used when
 * auth.json yielded nothing. The env var name serves as the account label.
 *
 * @returns Discovered accounts in auth.json key order (empty when none)
 */
function discoverAccounts(): DiscoveredAccount[] {
  const accounts: DiscoveredAccount[] = [];
  const seenProviderIds = new Set<string>();

  for (const authPath of getAuthFilePathCandidates()) {
    if (!fs.existsSync(authPath)) continue;
    try {
      const content = fs.readFileSync(authPath, 'utf-8');
      const authData = JSON.parse(content) as Record<string, unknown>;

      for (const providerId of Object.keys(authData)) {
        if (seenProviderIds.has(providerId)) continue;
        if (!isExactProviderId(providerId) && !isMultiAccountProviderId(providerId)) continue;

        const token = extractKeyFromEntry(authData[providerId]);
        const platform = detectPlatform(providerId);
        if (token && platform) {
          seenProviderIds.add(providerId);
          accounts.push({ providerId, token, platform });
        }
      }
    } catch {
      // Silent fail, try next candidate path
    }
  }

  if (accounts.length === 0) {
    if (process.env.ZAI_API_KEY) {
      accounts.push({
        providerId: 'ZAI_API_KEY',
        token: process.env.ZAI_API_KEY,
        platform: 'ZAI'
      });
    } else if (process.env.ZHIPU_API_KEY || process.env.ZHIPUAI_API_KEY) {
      const token = (process.env.ZHIPU_API_KEY || process.env.ZHIPUAI_API_KEY)!;
      accounts.push({
        providerId: process.env.ZHIPU_API_KEY ? 'ZHIPU_API_KEY' : 'ZHIPUAI_API_KEY',
        token,
        platform: 'ZHIPU'
      });
    }
  }

  return accounts;
}

/**
 * Create error message for missing credentials
 * @returns Error message with setup instructions (Markdown formatted)
 */
function createCredentialError(): string {
  return createMarkdownError(
    'Credentials Not Found',
    {},
    'Please authenticate first.',
    [
      'Run `/connect` command in OpenCode TUI.',
      'Select "Z.AI Coding Plan", "Z.AI", or "Zhipu".',
      'For development/testing, set `ZAI_API_KEY` or `ZHIPU_API_KEY`.'
    ]
  );
}

// ============================================================================
// RESPONSE PROCESSING
// ============================================================================

/**
 * Process quota limit response
 * @param data - Raw API response
 * @returns Processed response with human-readable types
 */
function processQuotaLimit(data: Record<string, unknown>): ProcessedQuotaLimit {
  const result = { ...data };

  if (result.limits && Array.isArray(result.limits)) {
    result.limits = result.limits.map((item: unknown) => {
      if (typeof item === 'object' && item !== null) {
        const limit = item as Record<string, unknown>;

        if (limit.type === TOKEN_LIMIT_TYPE) {
          return {
            type: getTokenLimitLabel(limit),
            rawType: TOKEN_LIMIT_TYPE,
            unit: typeof limit.unit === 'number' ? limit.unit : undefined,
            number: typeof limit.number === 'number' ? limit.number : undefined,
            percentage: typeof limit.percentage === 'number' ? limit.percentage : 0,
            nextResetTime: limit.nextResetTime as number | undefined
          };
        }

        if (limit.type === TIME_LIMIT_TYPE) {
          return {
            type: MCP_LIMIT_LABEL,
            percentage: typeof limit.percentage === 'number' ? limit.percentage : 0,
            currentValue: limit.currentValue,
            total: limit.usage,
            usageDetails: limit.usageDetails as Record<string, unknown> | undefined
          };
        }
      }
      return item;
    });
  }

  return result as ProcessedQuotaLimit;
}

// ============================================================================
// OUTPUT FORMATTING
// ============================================================================

/**
 * Format number with thousand separators
 */
function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * Get token limit information from quota data
 */
function getTokenLimitInfo(quotaData: ProcessedQuotaLimit | null): { tokenLimit: number; tokenPct: number } {
  let tokenLimit = DEFAULT_TOKEN_LIMIT;
  let tokenPct = 0;
  let hasFiveHourMatch = false;

  if (!quotaData?.limits) return { tokenLimit, tokenPct };

  for (const limit of quotaData.limits) {
    if (isFiveHourTokenLimit(limit)) {
      tokenPct = typeof limit.percentage === 'number' ? limit.percentage : 0;
      tokenLimit = (limit.total as number) || DEFAULT_TOKEN_LIMIT;
      hasFiveHourMatch = true;
      break;
    }
  }

  if (!hasFiveHourMatch) {
    for (const limit of quotaData.limits) {
      if (limit.rawType === TOKEN_LIMIT_TYPE || limit.type === FIVE_HOUR_TOKEN_LIMIT_LABEL) {
        tokenPct = typeof limit.percentage === 'number' ? limit.percentage : 0;
        tokenLimit = (limit.total as number) || DEFAULT_TOKEN_LIMIT;
        break;
      }
    }
  }

  return { tokenLimit, tokenPct };
}

/**
 * Format MCP tool details as readable lines
 */
function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatPlanLevel(level?: string): string {
  if (!level) {
    return '';
  }

  return level.charAt(0).toUpperCase() + level.slice(1).toLowerCase();
}

function formatResetCell(resetTime?: number): string {
  const resetAt = asNumber(resetTime);
  if (resetAt === null) {
    return '—';
  }

  const diffMs = resetAt - Date.now();
  if (diffMs <= 0) {
    return '—';
  }

  const totalMinutes = Math.floor(diffMs / (1000 * 60));

  // Format countdown portion
  let countdown: string;
  if (totalMinutes >= 24 * 60) {
    const totalHours = Math.floor(totalMinutes / 60);
    countdown = `${Math.floor(totalHours / 24)}d ${totalHours % 24}h`;
  } else {
    countdown = `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
  }

  // Format local reset time portion (Issue #34: show actual clock time)
  const resetDate = new Date(resetAt);
  const hh = String(resetDate.getHours()).padStart(2, '0');
  const mm = String(resetDate.getMinutes()).padStart(2, '0');

  if (totalMinutes >= 24 * 60) {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${countdown} (${dayNames[resetDate.getDay()]} ${hh}:${mm})`;
  }

  return `${countdown} (${hh}:${mm})`;
}

function formatMarkdownTable(headers: string[], separator: string[], rows: string[][]): string {
  const tableRows = rows.map((row) => `| ${row.join(' | ')} |`);
  return [`| ${headers.join(' | ')} |`, `|${separator.join('|')}|`, ...tableRows].join('\n');
}

function formatMarkdownHeader(
  accountLabel: string,
  platformName: string,
  startTime: string,
  endTime: string,
  level?: string
): string {
  const title = level
    ? `${MAIN_TITLE_PREFIX}${formatPlanLevel(level)}`
    : '### 📊 Z.ai GLM Coding Plan';

  return [
    title,
    '',
    `- **Account**: ${accountLabel}`,
    `- **Platform**: ${platformName}`,
    `- **Period**: ${startTime} → ${endTime}`
  ].join('\n');
}

function formatQuotaWindowLabel(type: string): string {
  if (type === FIVE_HOUR_TOKEN_LIMIT_LABEL) {
    return `${ROW_EMOJI.TOKEN} 5h Token`;
  }

  if (type === 'Token usage(Weekly)') {
    return `${ROW_EMOJI.WEEKLY} Weekly`;
  }

  if (type === MCP_LIMIT_LABEL) {
    return `${ROW_EMOJI.MCP} MCP (1 Month)`;
  }

  return type;
}

function formatQuotaLimitsTable(quotaData: ProcessedQuotaLimit | null): string {
  const rows = quotaData?.limits?.length
    ? quotaData.limits.map((limit) => {
      const percentage = typeof limit.percentage === 'number' ? limit.percentage : 0;
      return [
        formatQuotaWindowLabel(limit.type || 'Unknown'),
        `${percentage.toFixed(1)}%`,
        formatProgressLine(limit.type || 'Unknown', percentage),
        limit.type === MCP_LIMIT_LABEL ? '—' : formatResetCell(limit.nextResetTime)
      ];
    })
    : [['No quota data available', '—', '—', '—']];

  return formatMarkdownTable(
    ['Window', 'Usage', 'Progress', 'Resets In'],
    ['--------', '------:', '----------', '-----------'],
    rows
  );
}

function formatQuotaUsageTable(
  quotaData: ProcessedQuotaLimit | null,
  modelData: Record<string, unknown> | null
): string {
  const tokenCount = asNumber((modelData?.totalUsage as Record<string, unknown> | undefined)?.totalTokensUsage);
  const { tokenLimit } = getTokenLimitInfo(quotaData);
  const mcpLimit = quotaData?.limits?.find((limit) => limit.type === MCP_LIMIT_LABEL);
  const mcpCurrent = asNumber(mcpLimit?.currentValue);
  const mcpTotal = asNumber(mcpLimit?.total);

  return formatMarkdownTable(
    ['Metric', 'Value'],
    ['--------', '------:'],
    [
      ['💰 **Token Used**', tokenCount === null ? '—' : `**${formatNumber(tokenCount)} / ${formatNumber(tokenLimit)}**`],
      ['🔌 **MCP Used**', mcpCurrent === null || mcpTotal === null ? '—' : `**${mcpCurrent} / ${mcpTotal}**`]
    ]
  );
}

function formatMcpToolLabel(modelCode: string): string {
  if (modelCode === 'search-prime') {
    return '🔍 Network Searches';
  }

  if (modelCode === 'web-reader') {
    return '🌐 Web Reads';
  }

  if (modelCode === 'zread') {
    return '📖 ZRead Calls';
  }

  return modelCode;
}

function formatMcpBreakdownTable(quotaData: ProcessedQuotaLimit | null): string {
  const mcpLimit = quotaData?.limits?.find((limit) => limit.type === MCP_LIMIT_LABEL);
  const details = Array.isArray(mcpLimit?.usageDetails)
    ? mcpLimit.usageDetails as Array<{ modelCode: string; usage: number }>
    : [];
  const rows = details.length
    ? details.map((detail) => [formatMcpToolLabel(detail.modelCode), formatNumber(detail.usage)])
    : [['No MCP data available', '—']];

  return formatMarkdownTable(['Tool', 'Count'], ['------', '------:'], rows);
}

function formatModelUsageTable(
  modelData: Record<string, unknown> | null,
  quotaData: ProcessedQuotaLimit | null
): string {
  const totalUsage = modelData?.totalUsage as Record<string, unknown> | undefined;
  const rows: string[][] = [];
  const { tokenLimit, tokenPct } = getTokenLimitInfo(quotaData);
  const calls = asNumber(totalUsage?.totalModelCallCount);
  const tokens = asNumber(totalUsage?.totalTokensUsage);

  if (tokens !== null) {
    const pct24h = Math.round((tokens / tokenLimit) * 100);
    rows.push(['🔢 Total Tokens', `${formatNumber(tokens)} (${pct24h}% of 5h limit)`]);
    rows.push(['⏱️ 5h Window', `${tokenPct.toFixed(1)}% of ${formatNumber(tokenLimit)}`]);
  }

  if (calls !== null) {
    rows.push(['📞 Total Calls', formatNumber(calls)]);
  }

  return formatMarkdownTable(
    ['Metric', 'Value'],
    ['--------', '------:'],
    rows.length > 0 ? rows : [['No model usage data available', '—']]
  );
}

function formatToolUsageTable(toolData: Record<string, unknown> | null): string {
  const totalUsage = toolData?.totalUsage as Record<string, unknown> | undefined;
  const counts: Array<[string, number | null]> = [
    ['🔍 Network Searches', asNumber(totalUsage?.totalNetworkSearchCount)],
    ['🌐 Web Reads', asNumber(totalUsage?.totalWebReadMcpCount)],
    ['🎭 ZRead Calls', asNumber(totalUsage?.totalZreadMcpCount)]
  ];
  const rows = counts
    .filter(([, count]) => count !== null)
    .map(([label, count]) => [label, formatNumber(count as number)]);

  return formatMarkdownTable(
    ['Tool', 'Count'],
    ['------', '------:'],
    rows.length > 0 ? rows : [['No tool usage data available', '—']]
  );
}

function formatMarkdownOutput(
  accountLabel: string,
  platform: Platform,
  startTime: string,
  endTime: string,
  quotaData: ProcessedQuotaLimit | null,
  modelData: Record<string, unknown> | null,
  toolData: Record<string, unknown> | null
): string {
  const platformName = getPlatformName(platform);
  const level = quotaData?.level as string | undefined;

  return [
    formatMarkdownHeader(accountLabel, platformName, startTime, endTime, level),
    `${SECTION_HEADERS.QUOTA_LIMITS}\n\n${formatQuotaLimitsTable(quotaData)}`,
    `${SECTION_HEADERS.QUOTA_USAGE}\n\n${formatQuotaUsageTable(quotaData, modelData)}`,
    `${SECTION_HEADERS.MCP_BREAKDOWN}\n\n${formatMcpBreakdownTable(quotaData)}`,
    `${SECTION_HEADERS.MODEL_USAGE}\n\n${formatModelUsageTable(modelData, quotaData)}`,
    `${SECTION_HEADERS.TOOL_USAGE}\n\n${formatToolUsageTable(toolData)}`
  ].join('\n\n');
}

// ============================================================================
// MAIN QUERY FUNCTION
// ============================================================================

/**
 * Unwrap a settled endpoint promise into its response data, mapping
 * rejections to null so a single failed endpoint degrades to an empty
 * section while the rest of the dashboard still renders.
 * @param settled - Settled result of one endpoint query
 * @returns Response data, or null when the endpoint failed
 */
function settledResponseData(
  settled: PromiseSettledResult<ApiResponse>
): Record<string, unknown> | null {
  return settled.status === 'fulfilled'
    ? (settled.value.data ?? settled.value) as Record<string, unknown>
    : null;
}

/**
 * Render one account's usage dashboard.
 *
 * All three endpoints are queried once for this account. A partial failure
 * (some endpoints succeed) degrades per endpoint exactly as before. A total
 * failure (every endpoint rejected) throws so the caller renders a loud
 * error section for THIS account without masking the failure behind an
 * empty-looking dashboard.
 *
 * @param account - The discovered account to query
 * @returns Formatted dashboard markdown for the account
 */
async function queryAllUsage(account: DiscoveredAccount): Promise<string> {
  const { providerId, token, platform } = account;
  const endpoints = getEndpoints(platform);
  const { startTime, endTime } = getTimeWindow();
  const queryParams = getTimeWindowQueryParams();

  // Query all endpoints
  const [quotaResult, modelResult, toolResult] = await Promise.allSettled([
    queryEndpoint(endpoints, token, 'quotaLimit'),
    queryEndpoint(endpoints, token, 'modelUsage', queryParams),
    queryEndpoint(endpoints, token, 'toolUsage', queryParams)
  ]);

  // Total failure: surface a loud per-account error (fail fast, no silent skip)
  if (quotaResult.status === 'rejected' && modelResult.status === 'rejected' && toolResult.status === 'rejected') {
    throw quotaResult.reason instanceof Error ? quotaResult.reason : new Error(String(quotaResult.reason));
  }

  // Process responses
  const quotaRawData = settledResponseData(quotaResult);
  const quotaData = quotaRawData ? processQuotaLimit(quotaRawData) : null;

  const modelData = settledResponseData(modelResult);
  const toolData = settledResponseData(toolResult);

  return formatMarkdownOutput(providerId, platform, startTime, endTime, quotaData, modelData, toolData);
}

// ============================================================================
// PLUGIN ENTRYPOINTS (dual shape)
// ============================================================================

/**
 * The glm_quota tool description, shared verbatim by both entrypoints.
 */
const GLM_QUOTA_DESCRIPTION =
  'Query Z.ai GLM Coding Plan usage statistics including quota limits, model usage, and MCP tool usage';

/**
 * Render one account's section: its dashboard on success, a loud labeled
 * error section on failure. The error section names the provider id in the
 * title and identifies the credential via its masked key, so one account's
 * failure never leaks into or silences another account's section.
 *
 * @param account - The discovered account to render
 * @param multi - True when more than one account was discovered; adds a
 *   `## <provider-id>` heading so sections are clearly separated
 * @returns The account's markdown section
 */
async function renderAccountSection(account: DiscoveredAccount, multi: boolean): Promise<string> {
  let content: string;

  try {
    content = await queryAllUsage(account);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    content = createMarkdownError(
      `Account Query Failed: ${account.providerId}`,
      { Key: maskKey(account.token) },
      message
    );
  }

  return multi ? `## ${account.providerId}\n\n${content}` : content;
}

/**
 * Run the quota query across every discovered account and return the
 * Markdown output.
 *
 * Single quota-fetch path shared by the V1 and V2 registrations. Guards per
 * the ratified amendment 9 discipline: failures are returned as loud
 * Markdown content, never thrown at the host. Every auth.json account in the
 * zai-max family (plus the legacy exact ids) is queried once and rendered as
 * its own labeled section; per-account API failures are isolated so a broken
 * account cannot mask a healthy one. The zero-accounts outcome is the
 * explicit "Credentials Not Found" error content with setup instructions.
 *
 * @returns Markdown quota summary or Markdown error message
 */
async function runQuotaQuery(): Promise<string> {
  try {
    const accounts = discoverAccounts();

    if (accounts.length === 0) {
      return createCredentialError();
    }

    const multi = accounts.length > 1;
    const sections = await Promise.all(
      accounts.map((account) => renderAccountSection(account, multi))
    );

    return sections.join('\n\n');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.trim().startsWith('### ⚠️ ')) {
      return errorMessage;
    }

    return createMarkdownError('Error', {}, errorMessage);
  }
}

/**
 * V1 entrypoint: legacy hosts call `server()` and use the returned hooks.
 * Byte-compatible with the v1.8.4 export: same hooks object shape, same tool
 * definition, same execute behavior (the removed `tool()` helper was an
 * identity function, so the host received exactly this object before).
 *
 * @returns V1 hooks containing the glm_quota tool
 */
async function server(): Promise<V1PluginHooks> {
  return {
    tool: {
      glm_quota: {
        description: GLM_QUOTA_DESCRIPTION,
        args: {},
        async execute(): Promise<string> {
          return runQuotaQuery();
        }
      }
    }
  };
}

/**
 * V2 entrypoint: registers the glm_quota tool through `ctx.tool.transform`
 * with a JSON Schema input and a structured `{ content }` return.
 *
 * @param ctx - V2 plugin context (domain APIs)
 */
async function setup(ctx: V2PluginContext): Promise<void> {
  await ctx.tool.transform((editor) => {
    editor.add({
      name: 'glm_quota',
      description: GLM_QUOTA_DESCRIPTION,
      input: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      async execute(): Promise<{ content: string }> {
        const content = await runQuotaQuery();
        return { content };
      }
    });
  });
}

/**
 * Dual-shape default export (frozen migration guide, "Support V1 and V2 from
 * one package"): V1 hosts call `server()`, V2 hosts call `setup()`. The plain
 * object matches the `Plugin.define` output shape without importing it, so
 * the package has no runtime dependency on any opencode package.
 */
export default { id: 'opencode-glm-quota', setup, server };
