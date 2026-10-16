/**
 * OpenCode GLM Quota Plugin
 *
 * Query Z.ai GLM Coding Plan usage statistics including quota limits,
 * model usage, and MCP tool usage.
 */
import * as fs from "fs";
import { detectPlatform, getPlatformName } from "./api/platforms.js";
import { getEndpoints } from "./api/endpoints.js";
import { queryEndpoint } from "./api/client.js";
import { getTimeWindow, getTimeWindowQueryParams } from "./utils/time-window.js";
import { getAuthFilePathCandidates } from "./utils/auth-path.js";
import { formatProgressLine } from "./utils/progress-bar.js";
import { MAIN_TITLE_PREFIX, ROW_EMOJI, SECTION_HEADERS } from "./utils/markdown-constants.js";
import { createMarkdownError } from "./utils/error-formatter.js";
import { FIVE_HOUR_TOKEN_LIMIT_LABEL, getTokenLimitLabel, isFiveHourTokenLimit } from "./utils/token-limits.js";
// ============================================================================
// CONSTANTS
// ============================================================================
const CANDIDATE_PROVIDER_IDS = [
    'zai-coding-plan',
    'zai',
    'z-ai',
    'z.ai',
    'zhipu',
    'zhipuai',
    // The v2-migration config defines its Z.ai provider under the id `zai-max`;
    // detectPlatform() already resolves it to ZAI, so discovery only needs the id.
    'zai-max'
];
const DEFAULT_TOKEN_LIMIT = 40000000;
const MCP_LIMIT_LABEL = 'MCP usage(1 Month)';
const TOKEN_LIMIT_TYPE = 'TOKENS_LIMIT';
const TIME_LIMIT_TYPE = 'TIME_LIMIT';
// ============================================================================
// CREDENTIAL DISCOVERY
// ============================================================================
/**
 * Extract API key from auth entry
 * @param entry - Auth entry (string or object)
 * @returns API key or null
 */
function extractKeyFromEntry(entry) {
    if (typeof entry === 'string')
        return entry;
    if (typeof entry === 'object' && entry !== null) {
        const obj = entry;
        for (const keyName of ['apiKey', 'api_key', 'token', 'key', 'accessToken', 'auth_token']) {
            if (typeof obj[keyName] === 'string')
                return obj[keyName];
        }
    }
    return null;
}
/**
 * Get credentials from OpenCode auth.json or environment variables
 * @returns Credentials or null if not found
 */
async function getCredentials() {
    // Priority 1: OpenCode auth.json — probe EVERY candidate path (legacy
    // LOCALAPPDATA on Windows, then the cross-platform XDG path) so a stale or
    // partial file at one location does not mask valid credentials at another.
    for (const authPath of getAuthFilePathCandidates()) {
        if (!fs.existsSync(authPath))
            continue;
        try {
            const content = fs.readFileSync(authPath, 'utf-8');
            const authData = JSON.parse(content);
            for (const providerId of CANDIDATE_PROVIDER_IDS) {
                const entry = authData[providerId];
                if (entry) {
                    const token = extractKeyFromEntry(entry);
                    if (token) {
                        const platform = detectPlatform(providerId);
                        if (platform) {
                            return { token, platform };
                        }
                    }
                }
            }
        }
        catch {
            // Silent fail, try next candidate / fallback method
        }
    }
    // Priority 2: Environment variables (for development/testing)
    if (process.env.ZAI_API_KEY) {
        return { token: process.env.ZAI_API_KEY, platform: 'ZAI' };
    }
    if (process.env.ZHIPU_API_KEY || process.env.ZHIPUAI_API_KEY) {
        return {
            token: (process.env.ZHIPU_API_KEY || process.env.ZHIPUAI_API_KEY),
            platform: 'ZHIPU'
        };
    }
    return null;
}
/**
 * Create error message for missing credentials
 * @returns Error message with setup instructions (Markdown formatted)
 */
function createCredentialError() {
    return createMarkdownError('Credentials Not Found', {}, 'Please authenticate first.', [
        'Run `/connect` command in OpenCode TUI.',
        'Select "Z.AI Coding Plan", "Z.AI", or "Zhipu".',
        'For development/testing, set `ZAI_API_KEY` or `ZHIPU_API_KEY`.'
    ]);
}
// ============================================================================
// RESPONSE PROCESSING
// ============================================================================
/**
 * Process quota limit response
 * @param data - Raw API response
 * @returns Processed response with human-readable types
 */
function processQuotaLimit(data) {
    const result = { ...data };
    if (result.limits && Array.isArray(result.limits)) {
        result.limits = result.limits.map((item) => {
            if (typeof item === 'object' && item !== null) {
                const limit = item;
                if (limit.type === TOKEN_LIMIT_TYPE) {
                    return {
                        type: getTokenLimitLabel(limit),
                        rawType: TOKEN_LIMIT_TYPE,
                        unit: typeof limit.unit === 'number' ? limit.unit : undefined,
                        number: typeof limit.number === 'number' ? limit.number : undefined,
                        percentage: typeof limit.percentage === 'number' ? limit.percentage : 0,
                        nextResetTime: limit.nextResetTime
                    };
                }
                if (limit.type === TIME_LIMIT_TYPE) {
                    return {
                        type: MCP_LIMIT_LABEL,
                        percentage: typeof limit.percentage === 'number' ? limit.percentage : 0,
                        currentValue: limit.currentValue,
                        total: limit.usage,
                        usageDetails: limit.usageDetails
                    };
                }
            }
            return item;
        });
    }
    return result;
}
// ============================================================================
// OUTPUT FORMATTING
// ============================================================================
/**
 * Format number with thousand separators
 */
function formatNumber(num) {
    return num.toLocaleString('en-US');
}
/**
 * Get token limit information from quota data
 */
function getTokenLimitInfo(quotaData) {
    let tokenLimit = DEFAULT_TOKEN_LIMIT;
    let tokenPct = 0;
    let hasFiveHourMatch = false;
    if (!quotaData?.limits)
        return { tokenLimit, tokenPct };
    for (const limit of quotaData.limits) {
        if (isFiveHourTokenLimit(limit)) {
            tokenPct = typeof limit.percentage === 'number' ? limit.percentage : 0;
            tokenLimit = limit.total || DEFAULT_TOKEN_LIMIT;
            hasFiveHourMatch = true;
            break;
        }
    }
    if (!hasFiveHourMatch) {
        for (const limit of quotaData.limits) {
            if (limit.rawType === TOKEN_LIMIT_TYPE || limit.type === FIVE_HOUR_TOKEN_LIMIT_LABEL) {
                tokenPct = typeof limit.percentage === 'number' ? limit.percentage : 0;
                tokenLimit = limit.total || DEFAULT_TOKEN_LIMIT;
                break;
            }
        }
    }
    return { tokenLimit, tokenPct };
}
/**
 * Format MCP tool details as readable lines
 */
function asNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function formatPlanLevel(level) {
    if (!level) {
        return '';
    }
    return level.charAt(0).toUpperCase() + level.slice(1).toLowerCase();
}
function formatResetCell(resetTime) {
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
    let countdown;
    if (totalMinutes >= 24 * 60) {
        const totalHours = Math.floor(totalMinutes / 60);
        countdown = `${Math.floor(totalHours / 24)}d ${totalHours % 24}h`;
    }
    else {
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
function formatMarkdownTable(headers, separator, rows) {
    const tableRows = rows.map((row) => `| ${row.join(' | ')} |`);
    return [`| ${headers.join(' | ')} |`, `|${separator.join('|')}|`, ...tableRows].join('\n');
}
function formatMarkdownHeader(platformName, startTime, endTime, level) {
    const title = level
        ? `${MAIN_TITLE_PREFIX}${formatPlanLevel(level)}`
        : '### 📊 Z.ai GLM Coding Plan';
    return [
        title,
        '',
        `- **Platform**: ${platformName}`,
        `- **Period**: ${startTime} → ${endTime}`
    ].join('\n');
}
function formatQuotaWindowLabel(type) {
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
function formatQuotaLimitsTable(quotaData) {
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
    return formatMarkdownTable(['Window', 'Usage', 'Progress', 'Resets In'], ['--------', '------:', '----------', '-----------'], rows);
}
function formatQuotaUsageTable(quotaData, modelData) {
    const tokenCount = asNumber(modelData?.totalUsage?.totalTokensUsage);
    const { tokenLimit } = getTokenLimitInfo(quotaData);
    const mcpLimit = quotaData?.limits?.find((limit) => limit.type === MCP_LIMIT_LABEL);
    const mcpCurrent = asNumber(mcpLimit?.currentValue);
    const mcpTotal = asNumber(mcpLimit?.total);
    return formatMarkdownTable(['Metric', 'Value'], ['--------', '------:'], [
        ['💰 **Token Used**', tokenCount === null ? '—' : `**${formatNumber(tokenCount)} / ${formatNumber(tokenLimit)}**`],
        ['🔌 **MCP Used**', mcpCurrent === null || mcpTotal === null ? '—' : `**${mcpCurrent} / ${mcpTotal}**`]
    ]);
}
function formatMcpToolLabel(modelCode) {
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
function formatMcpBreakdownTable(quotaData) {
    const mcpLimit = quotaData?.limits?.find((limit) => limit.type === MCP_LIMIT_LABEL);
    const details = Array.isArray(mcpLimit?.usageDetails)
        ? mcpLimit.usageDetails
        : [];
    const rows = details.length
        ? details.map((detail) => [formatMcpToolLabel(detail.modelCode), formatNumber(detail.usage)])
        : [['No MCP data available', '—']];
    return formatMarkdownTable(['Tool', 'Count'], ['------', '------:'], rows);
}
function formatModelUsageTable(modelData, quotaData) {
    const totalUsage = modelData?.totalUsage;
    const rows = [];
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
    return formatMarkdownTable(['Metric', 'Value'], ['--------', '------:'], rows.length > 0 ? rows : [['No model usage data available', '—']]);
}
function formatToolUsageTable(toolData) {
    const totalUsage = toolData?.totalUsage;
    const counts = [
        ['🔍 Network Searches', asNumber(totalUsage?.totalNetworkSearchCount)],
        ['🌐 Web Reads', asNumber(totalUsage?.totalWebReadMcpCount)],
        ['🎭 ZRead Calls', asNumber(totalUsage?.totalZreadMcpCount)]
    ];
    const rows = counts
        .filter(([, count]) => count !== null)
        .map(([label, count]) => [label, formatNumber(count)]);
    return formatMarkdownTable(['Tool', 'Count'], ['------', '------:'], rows.length > 0 ? rows : [['No tool usage data available', '—']]);
}
function formatMarkdownOutput(platform, startTime, endTime, quotaData, modelData, toolData) {
    const platformName = getPlatformName(platform);
    const level = quotaData?.level;
    return [
        formatMarkdownHeader(platformName, startTime, endTime, level),
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
 * Query all usage statistics
 * @param credentials - API credentials
 * @returns Formatted output string
 */
async function queryAllUsage(credentials) {
    const { token, platform } = credentials;
    const endpoints = getEndpoints(platform);
    const { startTime, endTime } = getTimeWindow();
    const queryParams = getTimeWindowQueryParams();
    // Query all endpoints
    const [quotaResponse, modelResponse, toolResponse] = await Promise.all([
        queryEndpoint(endpoints, token, 'quotaLimit').catch(() => null),
        queryEndpoint(endpoints, token, 'modelUsage', queryParams).catch(() => null),
        queryEndpoint(endpoints, token, 'toolUsage', queryParams).catch(() => null)
    ]);
    // Process responses
    const quotaData = quotaResponse
        ? processQuotaLimit(quotaResponse.data)
        : null;
    const modelData = modelResponse
        ? (modelResponse.data || modelResponse)
        : null;
    const toolData = toolResponse
        ? (toolResponse.data || toolResponse)
        : null;
    return formatMarkdownOutput(platform, startTime, endTime, quotaData, modelData, toolData);
}
// ============================================================================
// PLUGIN ENTRYPOINTS (dual shape)
// ============================================================================
/**
 * The glm_quota tool description, shared verbatim by both entrypoints.
 */
const GLM_QUOTA_DESCRIPTION = 'Query Z.ai GLM Coding Plan usage statistics including quota limits, model usage, and MCP tool usage';
/**
 * Run the quota query and return the Markdown summary.
 *
 * Single quota-fetch path shared by the V1 and V2 registrations. Guards per
 * the ratified amendment 9 discipline: non-essential failures (network, API,
 * rendering) are caught and returned as loud Markdown error content — never
 * thrown at the host — while the missing-credentials outcome is the explicit
 * "Credentials Not Found" error content with setup instructions (loud, not
 * swallowed). Credential discovery itself (auth.json candidates → env vars)
 * is unchanged from V1.
 *
 * @returns Markdown quota summary or Markdown error message
 */
async function runQuotaQuery() {
    try {
        const credentials = await getCredentials();
        if (!credentials) {
            return createCredentialError();
        }
        return await queryAllUsage(credentials);
    }
    catch (error) {
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
async function server() {
    return {
        tool: {
            glm_quota: {
                description: GLM_QUOTA_DESCRIPTION,
                args: {},
                async execute() {
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
async function setup(ctx) {
    await ctx.tool.transform((editor) => {
        editor.add({
            name: 'glm_quota',
            description: GLM_QUOTA_DESCRIPTION,
            input: {
                type: 'object',
                properties: {},
                additionalProperties: false
            },
            async execute() {
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
