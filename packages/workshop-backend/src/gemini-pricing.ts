import type { ModelCost } from "@earendil-works/pi-ai";

/**
 * Google Gemini 官方定价核算规则
 * 参考文档：https://ai.google.dev/gemini-api/docs/pricing
 *
 * 单位均为 USD per 1M tokens (每百万 Tokens 的美元费用)
 * pi-ai 的 calculateCost 计算逻辑为：(rate / 1,000,000) * tokens
 */

/** 一个价格时段：at < until（epoch ms）时按 cost 计费；没有 until 的时段一直有效。 */
type PricePeriod = { until?: number; cost: ModelCost };

/** 一条价目：按小写化的模型 ID 匹配，periods 按时间顺序排列，命中 at 的第一个时段生效。 */
type GooglePriceRule = {
  match: (normalizedId: string) => boolean;
  periods: PricePeriod[];
};

// Gemini 4 Argon / Carbon 在 2026-12-01 00:00:00 UTC 调价（以 UTC 为准，
// 与 Google 文档标注的时点最多相差 8 小时）。
const GEMINI_4_PRICE_CHANGE_UTC = Date.UTC(2026, 11, 1);

// Flash 系列半价优惠截至 2026-12-31 23:59:59.999 UTC，2027-01-01 起恢复标准价。
// 作为时段边界使用（不含此点），googlePriceSchedule 据此预告「自 2027-01-01 起」的新价。
const FLASH_PROMO_END_UTC = Date.UTC(2027, 0, 1);

// Gemini 3.x Flash 的价目：2026 年底前半价（0.75 / 3.75 / 0.075），之后恢复标准价
// （1.50 / 7.50 / 0.15）。未识别的 Gemini 型号也按这套兜底价走，见 GOOGLE_PRICES 末位。
const FLASH_PERIODS: PricePeriod[] = [
  { until: FLASH_PROMO_END_UTC, cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 } },
  { cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 } },
];

// 按声明顺序第一条匹配的规则生效，所以前缀互含时要把更具体的型号放前面。
const GOOGLE_PRICES: GooglePriceRule[] = [
  // Gemini 4 Hydrogen：全窗口统一价。
  {
    match: normalized => normalized.includes("gemini-4-hydrogen"),
    periods: [{ cost: { input: 1.5, output: 7.5, cacheRead: 0.075, cacheWrite: 0 } }],
  },

  // Gemini 4 Argon / Carbon：2026-12-01 00:00 UTC 前 2/10/0.10，之后 4/20/0.20。
  {
    match: normalized =>
      normalized.includes("gemini-4-argon") || normalized.includes("gemini-4-carbon"),
    periods: [
      { until: GEMINI_4_PRICE_CHANGE_UTC,
        cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 } },
      { cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 0 } },
    ],
  },

  // Gemini 3.8 / 3.7 / 3.6 / 3.5 Flash：走 FLASH_PERIODS 的半价→标准价切换。
  {
    match: normalized =>
      normalized.includes("gemini-3.8-flash") ||
      normalized.includes("gemini-3.6-flash") ||
      normalized.includes("gemini-3.7-flash") ||
      normalized.includes("gemini-3.5-flash"),
    periods: FLASH_PERIODS,
  },

  // Gemini 2.5 Flash Lite / 3.5 Flash Lite（3.5-flash-lite 会先命中上面的 3.x Flash 规则）。
  {
    match: normalized =>
      normalized.includes("gemini-2.5-flash-lite") || normalized.includes("gemini-3.5-flash-lite"),
    periods: [{ cost: { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 } }],
  },

  // Gemini 2.5 Flash / 2.0 Flash。
  {
    match: normalized =>
      normalized.includes("gemini-2.5-flash") || normalized.includes("gemini-2.0-flash"),
    periods: [{ cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 } }],
  },

  // Gemini Pro 系列 (2.5 Pro / 3.1 Pro，区分 200k 梯队)。
  {
    match: normalized =>
      normalized.includes("gemini-2.5-pro") || normalized.includes("gemini-3.1-pro"),
    periods: [{
      cost: {
        input: 1.25,
        output: 10,
        cacheRead: 0.3125,
        cacheWrite: 0,
        tiers: [
          {
            inputTokensAbove: 200_000,
            input: 2.5,
            output: 15,
            cacheRead: 0.625,
            cacheWrite: 0,
          },
        ],
      },
    }],
  },

  // 默认兜底：按当前主流 Flash 模型的半价/标准价走。
  { match: () => true, periods: FLASH_PERIODS },
];

function pricePeriods(modelId: string): PricePeriod[] {
  const normalized = modelId.toLowerCase();
  const rule = GOOGLE_PRICES.find(rule => rule.match(normalized));
  return rule?.periods ?? FLASH_PERIODS;
}

/**
 * 判断指定时间是否处于 Google Gemini 半价试用优惠期
 * 优惠期：截至 2026 年 12 月 31 日 23:59:59 UTC
 */
export function isGeminiPromoPeriod(atDate: Date = new Date()): boolean {
  return atDate.getTime() < FLASH_PROMO_END_UTC;
}

/**
 * 获取指定 Gemini 模型在 at 时的官方单价与已公布的下一次调价（如果有）。
 * 价格页用它展示「自某日起新价」。
 */
export function googlePriceSchedule(
  modelId: string,
  at: Date = new Date(),
): { current: ModelCost; next?: { from: Date; cost: ModelCost } } {
  const periods = pricePeriods(modelId);
  const t = at.getTime();
  const hit = periods.findIndex(period => period.until === undefined || t < period.until);
  const index = hit === -1 ? periods.length - 1 : hit;
  const current = periods[index];
  const upcoming = periods[index + 1];
  if (current.until === undefined || !upcoming) return { current: current.cost };
  return { current: current.cost, next: { from: new Date(current.until), cost: upcoming.cost } };
}

/**
 * 获取指定 Gemini 模型的实时核算费率 (ModelCost)
 */
export function getGoogleModelCost(modelId: string, atDate: Date = new Date()): ModelCost {
  return googlePriceSchedule(modelId, atDate).current;
}

/**
 * 针对缺少细分 token 的历史累计总量或兜底场景，按典型 Agent 对话分布做综合加权估算
 * 经验分布：~80% 为上下文/Prompt (含缓存命中与非缓存输入)，~20% 为回复与思考输出
 */
export function estimateTokenCost(tokens: number, atDate: Date = new Date()): number {
  if (!tokens || tokens <= 0) return 0;
  const isPromo = isGeminiPromoPeriod(atDate);
  // 半价期间加权单价：0.75 * 0.8 + 3.75 * 0.2 = $1.35 / 1M tokens
  // 恢复原价后加权单价：1.50 * 0.8 + 7.50 * 0.2 = $2.70 / 1M tokens
  const blendedRatePerMillion = isPromo ? 1.35 : 2.70;
  return (tokens / 1_000_000) * blendedRatePerMillion;
}

/**
 * Gemini 3.8 Flash 在旧版本 catalog 缺失时的回退配置
 */
export const GEMINI_3_8_FLASH_FALLBACK = {
  id: "gemini-3.8-flash",
  name: "Gemini 3.8 Flash",
  contextWindow: 1_048_576,
  maxTokens: 65_536,
  reasoning: true,
  thinkingLevelMap: {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
} as const;
