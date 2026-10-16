import type { ModelCost } from "@earendil-works/pi-ai";

/**
 * Google Gemini 官方定价核算规则
 * 参考文档：https://ai.google.dev/gemini-api/docs/pricing
 * 
 * 单位均为 USD per 1M tokens (每百万 Tokens 的美元费用)
 * pi-ai 的 calculateCost 计算逻辑为：(rate / 1,000,000) * tokens
 */

/**
 * 判断指定时间是否处于 Google Gemini 半价试用优惠期
 * 优惠期：截至 2026 年 12 月 31 日 23:59:59 UTC
 */
export function isGeminiPromoPeriod(atDate: Date = new Date()): boolean {
  // 截至 2026-12-31 享受半价优惠，2027-01-01 开始恢复标准价格
  const promoEndUtc = Date.UTC(2026, 11, 31, 23, 59, 59, 999);
  return atDate.getTime() <= promoEndUtc;
}

/**
 * 获取指定 Gemini 模型的实时核算费率 (ModelCost)
 */
export function getGoogleModelCost(modelId: string, atDate: Date = new Date()): ModelCost {
  const isPromo = isGeminiPromoPeriod(atDate);
  const normalized = modelId.toLowerCase();

  // Gemini 3.8 Flash & Gemini 3.6 Flash
  // 2026 年底前半价优惠：Input $0.75, Output $3.75, CacheRead $0.075
  // 2027 年恢复标准原价：Input $1.50, Output $7.50, CacheRead $0.15
  if (
    normalized.includes("gemini-3.8-flash") ||
    normalized.includes("gemini-3.6-flash") ||
    normalized.includes("gemini-3.7-flash") ||
    normalized.includes("gemini-3.5-flash")
  ) {
    return isPromo
      ? { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 }
      : { input: 1.50, output: 7.50, cacheRead: 0.15, cacheWrite: 0 };
  }

  // Gemini 2.5 Flash
  // Input: $0.30, Output: $2.50, CacheRead: $0.03
  if (normalized.includes("gemini-2.5-flash-lite") || normalized.includes("gemini-3.5-flash-lite")) {
    return { input: 0.10, output: 0.40, cacheRead: 0.01, cacheWrite: 0 };
  }
  if (normalized.includes("gemini-2.5-flash") || normalized.includes("gemini-2.0-flash")) {
    return { input: 0.30, output: 2.50, cacheRead: 0.03, cacheWrite: 0 };
  }

  // Gemini Pro 系列 (2.5 Pro / 3.1 Pro 等，区分 200k 梯队)
  if (normalized.includes("gemini-2.5-pro") || normalized.includes("gemini-3.1-pro")) {
    return {
      input: 1.25,
      output: 10.00,
      cacheRead: 0.3125,
      cacheWrite: 0,
      tiers: [
        {
          inputTokensAbove: 200_000,
          input: 2.50,
          output: 15.00,
          cacheRead: 0.625,
          cacheWrite: 0,
        },
      ],
    };
  }

  // 默认兜底：按当前主流 Flash 模型的半价/标准价走
  return isPromo
    ? { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 }
    : { input: 1.50, output: 7.50, cacheRead: 0.15, cacheWrite: 0 };
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
