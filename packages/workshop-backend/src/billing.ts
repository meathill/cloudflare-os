// 有缘心之助：预付费计费钩子。计费本身在主仓库 packages/billing（BILLING service binding）；
// 部署没有该 binding 时这里全部 no-op，自托管行为与上游一致。
//
// 谁付费：发起这次模型调用的人（AiChatAuthorInfo.id）——用户自己，或 Gadget 的 owner。
// 何时拦：agent turn 开始前、Gadget 模型 binding 开 session 前；何时扣：每次模型请求完成后。

import type { Usage } from "@earendil-works/pi-ai";
import type { AiChatAuthorInfo, AiModelConfig } from "@gadgets/workshop-shared/api";
import type {
  BillingAuthorization, BillingCharge, BillingChargeResult, BillingUsageSource,
} from "@gadgets/workshop-shared/billing";
import { createWorkshopLogger } from "./observability";

const logger = createWorkshopLogger("workshop.billing");

/**
 * One webSearch's raw cost: Gemini Search Grounding bills $35 per 1,000 grounded prompts, plus a
 * small model request that the fee dwarfs.
 */
export const WEB_SEARCH_RAW_COST_USD = 0.035;

/** 余额不足时拒绝开始（或中止）付费工作；消息直接展示给用户。 */
export class BillingRefusedError extends Error {}

/** Whether this deployment bills its users. */
export function billingEnabled(env: Cloudflare.Env): boolean {
  return env.BILLING !== undefined;
}

/**
 * The profile id billed for work `initiator` started: a user's own, or a gadget owner's (an agent
 * spawner's prompt names the owner). An agent never pays on its own account.
 */
export function billingPayer(initiator: AiChatAuthorInfo): string | undefined {
  return initiator.type === "agent" ? undefined : initiator.id;
}

/** The payer's standing, or null while billing is off. */
export function authorizeBilling(env: Cloudflare.Env, payer: string): Promise<BillingAuthorization | null> {
  return env.BILLING ? env.BILLING.authorize(payer) : Promise.resolve(null);
}

/** Throws BillingRefusedError unless `payer` may start paid work. */
export async function assertBillingAllowed(env: Cloudflare.Env, payer: string | undefined): Promise<void> {
  if (!payer) return;
  let authorization = await authorizeBilling(env, payer);
  if (authorization && !authorization.allowed) {
    throw new BillingRefusedError(authorization.reason ?? "余额不足，请先充值。");
  }
}

/**
 * The charge a completed model request sends to the billing Worker: raw cost, what incurred it,
 * the `${provider}/${modelId}` name SUGGESTED_MODELS and getModelPricing use, and the actual
 * token counts the provider reported. Callers pass a zero-cost usage through unchanged — the
 * request's token footprint still belongs in the ledger.
 */
export function billingCharge(source: BillingUsageSource,
                              config: Pick<AiModelConfig, "provider" | "model">,
                              usage: Usage | undefined,
                              context?: { workspaceId?: string; chatId?: number }): BillingCharge {
  return {
    rawCostUsd: usage?.cost.total ?? 0,
    source,
    model: `${config.provider}/${config.model}`,
    inputTokens: usage?.input ?? 0,
    outputTokens: usage?.output ?? 0,
    cacheReadTokens: usage?.cacheRead ?? 0,
    cacheWriteTokens: usage?.cacheWrite ?? 0,
    ...(context?.workspaceId !== undefined ? { workspaceId: context.workspaceId } : {}),
    ...(context?.chatId !== undefined ? { chatId: context.chatId } : {}),
  };
}

/**
 * Meter one request against `payer`. The request already happened, so a failure is logged rather
 * than thrown; null when nothing was charged.
 */
export async function chargeBilling(env: Cloudflare.Env, payer: string,
                                    charge: BillingCharge): Promise<BillingChargeResult | null> {
  if (!env.BILLING || !(charge.rawCostUsd > 0)) return null;
  try {
    return await env.BILLING.charge(payer, charge);
  } catch (error) {
    // Never log the payer: it is the user's email.
    logger.error(`failed to charge a model request (${charge.source}, $${charge.rawCostUsd})`, {
      event: "billing.charge.failed", error,
    });
    return null;
  }
}

/** Whether a charge left a standard payer with nothing to spend. */
export function balanceExhausted(result: BillingChargeResult | null): boolean {
  return result !== null && result.plan === "standard" && result.balanceUsd <= 0;
}
