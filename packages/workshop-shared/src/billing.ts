// 有缘心之助：预付费计费的 RPC 契约。实现在主仓库 packages/billing（独立 Worker，D1 + Stripe），
// Workshop 通过可选的 BILLING service binding 调用；没有该 binding 时计费整体关闭。

import type { RpcTarget, WorkerEntrypoint } from "cloudflare:workers";

/** Where Stripe delivers webhooks; the Workshop forwards it to the billing Worker unchanged. */
export const BILLING_STRIPE_WEBHOOK_PATH = "/api/billing/stripe/webhook";

/**
 * A user's billing plan. `standard` users prepay and are charged the raw model cost times their
 * effective markup; `internal` users are metered at raw cost but never charged or blocked.
 */
export type BillingPlan = "standard" | "internal";

/** What spent the money a charge records, for the usage breakdowns. */
export type BillingUsageSource =
  | "chat"
  | "cache-warm"
  | "title"
  | "compaction"
  | "gadget-llm"
  | "gadget-decision"
  | "web-search"
  /**
   * 剧作引擎后台整理团队经验与个人记忆的模型调用，平台承担。
   */
  | "memory";

/** Whether a user may start more paid work right now, decided before each agent turn. */
export type BillingAuthorization = {
  /** False when a standard user's balance is spent. */
  allowed: boolean;
  /** Why the user was refused, shown to them. Present only when `allowed` is false. */
  reason?: string;
  /** The user's plan. */
  plan: BillingPlan;
  /** The remaining balance in USD. May be negative: a turn in flight can overdraw it. */
  balanceUsd: number;
};

/** One metered request: its raw provider cost, what incurred it and what served it. */
export type BillingCharge = {
  /** The provider's price for the request, in USD, before any markup. */
  rawCostUsd: number;
  /** What incurred the cost. */
  source: BillingUsageSource;
  /**
   * The model that served the request: `${AiModelProvider}/${modelId}` — the same names as
   * SUGGESTED_MODELS and getModelPricing use — or "web-search" for a grounded search.
   */
  model: string;
  /** The request's actual token counts, as the provider reported them. */
  inputTokens: number;
  /** The request's actual token counts, as the provider reported them. */
  outputTokens: number;
  /** The request's actual token counts, as the provider reported them. */
  cacheReadTokens: number;
  /** The request's actual token counts, as the provider reported them. */
  cacheWriteTokens: number;
  /** The workspace the request belonged to, when there is one. */
  workspaceId?: string;
  /** The chat the request belonged to, when there is one. */
  chatId?: number;
};

/** The account after a charge. */
export type BillingChargeResult = {
  /** The user's plan. */
  plan: BillingPlan;
  /** The remaining balance in USD after the charge. */
  balanceUsd: number;
  /** What was deducted, in USD: the raw cost times the effective markup, or 0. */
  chargedUsd: number;
};

/** A user's balance and the ways they can add to it. */
export type BillingSummary = {
  /** The user's plan. */
  plan: BillingPlan;
  /** The remaining balance in USD. */
  balanceUsd: number;
  /** The top-up amounts offered, in USD. */
  topUpTiersUsd: number[];
  /** Whether online top-up is configured (Stripe keys present). */
  topUpEnabled: boolean;
};

/** How a ledger entry moved money; `plan` records an admin's plan or markup change and moves none. */
export type BillingLedgerKind = "topup" | "grant" | "refund" | "dispute" | "plan";

/** One movement of money into or out of a balance, other than usage. */
export type BillingLedgerEntry = {
  /** Stable id of the entry. */
  id: string;
  /** Whose balance the entry moved. */
  userKey: string;
  /** How the money moved. */
  kind: BillingLedgerKind;
  /** The amount in USD: positive adds to the balance, negative takes from it. */
  amountUsd: number;
  /** Free text: an admin's reason for a grant, or what a Stripe event was. */
  note: string;
  /** Who made the entry: an admin's username, or "stripe". */
  actor: string;
  /** When the entry was made, in epoch milliseconds. */
  createdAt: number;
};

/** One user's account as an admin sees it. */
export type BillingAccountInfo = {
  /** The user's profile id: their email, or the username of a legacy password account. */
  userKey: string;
  /** The user's plan. */
  plan: BillingPlan;
  /** The remaining balance in USD. */
  balanceUsd: number;
  /** All raw provider cost metered for the user, in USD. */
  rawCostTotalUsd: number;
  /** All that was deducted from the user, in USD. */
  chargedTotalUsd: number;
  /** The user's own markup, or null while they follow the deployment default. */
  markup: number | null;
  /**
   * The markup actually applied to their billable requests: their own, else the deployment
   * default; 0 on the internal plan (which never charges).
   */
  effectiveMarkup: number;
  /** The net total the user has topped up, in USD: top-ups less refunds and disputes. */
  topUpTotalUsd: number;
  /** When the account was created, in epoch milliseconds. */
  createdAt: number;
  /** When the account last changed, in epoch milliseconds. */
  updatedAt: number;
};

/** A usage-report time range: Beijing calendar days (YYYY-MM-DD), both ends inclusive. */
export type BillingUsageRange = {
  /** First day of the range, YYYY-MM-DD. */
  from: string;
  /** Last day of the range, YYYY-MM-DD. */
  to: string;
};

/** The four token counts every usage breakdown carries. */
export type BillingTokenCounts = {
  /** Input tokens, excluding cached reads and writes. */
  inputTokens: number;
  /** Output tokens. */
  outputTokens: number;
  /** Input tokens read from the provider's prompt cache. */
  cacheReadTokens: number;
  /** Input tokens written to the provider's prompt cache. */
  cacheWriteTokens: number;
};

/** An aggregate of metered usage: actual tokens, requests and costs in USD. */
export type BillingUsageTotals = BillingTokenCounts & {
  /** How many requests were metered. */
  requests: number;
  /** The raw provider cost in USD, before any markup. */
  rawCostUsd: number;
  /** What was deducted from users in USD. */
  chargedUsd: number;
  /**
   * 没向任何用户收费的请求的原始成本，包括内部 / 0x 用户和平台承担的来源；
   * 按 usage_daily 行判断，即扣费为 0 的行。
   */
  platformCostUsd: number;
};

/**
 * The admin's usage report for a range: actual tokens and both costs, broken down by model,
 * user, source and day, plus the range's ledger movement grouped by kind.
 */
export type BillingUsageReport = {
  /** The range the report covers. */
  range: BillingUsageRange;
  /** Everything metered in the range. */
  totals: BillingUsageTotals;
  /** Per model, by raw cost descending. */
  byModel: (BillingUsageTotals & { model: string })[];
  /** Per user, by raw cost descending. */
  byUser: (BillingUsageTotals & { userKey: string })[];
  /** Per usage source, by raw cost descending. */
  bySource: (BillingUsageTotals & { source: BillingUsageSource })[];
  /** Per Beijing day, ascending. */
  byDay: (BillingUsageTotals & { day: string })[];
  /** The range's ledger entries, grouped by kind. */
  ledger: { kind: BillingLedgerKind; amountUsd: number; count: number }[];
};

/** An admin's usage-report query: a range, optionally narrowed to one user and/or one usage source. The ledger summary is never narrowed by source. */
export type BillingUsageReportQuery = BillingUsageRange & {
  /** Restrict to one user's usage and ledger. */
  userKey?: string;
  /** Restrict the usage breakdowns and totals to one source. */
  source?: BillingUsageSource;
};

/**
 * One day of one model's usage as the user themselves sees it: billed tokens (actual times the
 * markup that applied when each request was charged) and what it cost them — never the raw cost.
 */
export type BillingUserUsageRow = BillingTokenCounts & {
  /** The Beijing day, YYYY-MM-DD. */
  day: string;
  /** The model that served the requests, named as BillingCharge.model is. */
  model: string;
  /** How many requests were metered. */
  requests: number;
  /** What was deducted from the user, in USD. */
  chargedUsd: number;
};

/** An admin's query for ledger entries in a range. */
export type BillingLedgerQuery = BillingUsageRange & {
  /** Restrict to one user's entries. */
  userKey?: string;
  /** Restrict to these kinds of entries; absent means all kinds. */
  kinds?: BillingLedgerKind[];
  /** Maximum entries returned (default 100, at most 200). */
  limit?: number;
};

/** One metered request as an admin sees it, newest first. */
export type BillingUsageEvent = BillingTokenCounts & {
  /** The event's own id; pass it as `before` to page back. */
  id: number;
  /** The user it was billed to. */
  userKey: string;
  /** When the request was metered, in epoch milliseconds. */
  createdAt: number;
  /** What incurred the cost. */
  source: BillingUsageSource;
  /** The model that served the request, named as BillingCharge.model is. */
  model: string;
  /** The markup that applied when this request was charged. */
  markup: number;
  /** The raw provider cost in USD. */
  rawCostUsd: number;
  /** What was deducted from the user in USD. */
  chargedUsd: number;
  /** The workspace the request belonged to, or null. */
  workspaceId: string | null;
  /** The chat the request belonged to, or null. */
  chatId: number | null;
};

/** An admin's query for one user's metered requests on one day. */
export type BillingUsageEventQuery = {
  /** The user whose events to list. */
  userKey: string;
  /** The Beijing day, YYYY-MM-DD. */
  day: string;
  /** Page cursor: only events with a smaller id are returned. */
  before?: number;
  /** Maximum events returned (default 100, at most 500). */
  limit?: number;
};

/** One user's view of their own billing; declared in api.ts, beside the browser API that hands it out. */
import type { BillingUserApi } from "./api.js";
export type { BillingUserApi };

/** How many users one getAccounts() call may ask for: a page of the admin's user list. */
export const BILLING_ACCOUNTS_PER_REQUEST = 100;

/**
 * 平台自己发起的用量记在这个账号下；`@` 开头，不会和真实用户名或邮箱冲突。
 */
export const BILLING_PLATFORM_USER_KEY = "@platform";

/** Deployment-admin operations on any user's billing. */
export interface BillingAdminApi extends RpcTarget {
  /**
   * The accounts of these users, at most BILLING_ACCOUNTS_PER_REQUEST of them; a user who has none
   * yet is left out.
   */
  getAccounts(userKeys: string[]): Promise<BillingAccountInfo[]>;
  /** Move a user to `plan`, creating their account if they have none yet; recorded in the ledger. */
  setPlan(userKey: string, plan: BillingPlan, actor: string): Promise<BillingAccountInfo>;
  /** Add `amountUsd` (negative to take some back) to a user's balance, with the admin's reason. */
  grant(userKey: string, amountUsd: number, note: string, actor: string): Promise<BillingAccountInfo>;
  /**
   * Set a user's own markup (0–10, two decimals), or null to follow the deployment default;
   * recorded in the ledger like a plan change.
   */
  setMarkup(userKey: string, markup: number | null, actor: string): Promise<BillingAccountInfo>;
  /** A user's ledger, newest first. */
  listLedger(userKey: string, limit?: number): Promise<BillingLedgerEntry[]>;
  /** The usage report for a range, optionally of one user alone and/or one source. */
  getUsageReport(query: BillingUsageReportQuery): Promise<BillingUsageReport>;
  /** Ledger entries in a range, newest first. */
  listLedgerEntries(query: BillingLedgerQuery): Promise<BillingLedgerEntry[]>;
  /** One user's metered requests on one day, newest first, paged by `before`. */
  listUsageEvents(query: BillingUsageEventQuery): Promise<BillingUsageEvent[]>;
}

/**
 * The billing Worker's entrypoint, as the Workshop reaches it over the BILLING service binding.
 * `userKey` is the user's profile id throughout.
 */
export interface BillingService extends WorkerEntrypoint {
  /** Whether the user may start paid work; creates a standard account on first sight. */
  authorize(userKey: string): Promise<BillingAuthorization>;
  /** Meter one request against the user. */
  charge(userKey: string, charge: BillingCharge): Promise<BillingChargeResult>;
  /** The user's own billing capability. */
  forUser(userKey: string): Promise<BillingUserApi>;
  /** The admin capability. The Workshop mints it only for deployment admins. */
  admin(): Promise<BillingAdminApi>;
}
