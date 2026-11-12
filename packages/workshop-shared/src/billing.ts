// 有缘心之助：预付费计费的 RPC 契约。实现在主仓库 packages/billing（独立 Worker，D1 + Stripe），
// Workshop 通过可选的 BILLING service binding 调用；没有该 binding 时计费整体关闭。

/**
 * A user's billing plan. `standard` users prepay and are charged the raw model cost times the
 * deployment's markup; `internal` users are metered at raw cost but never charged or blocked.
 */
export type BillingPlan = "standard" | "internal";

/** What spent the money a charge records, for the per-day usage breakdown. */
export type BillingUsageSource =
  | "chat"
  | "cache-warm"
  | "title"
  | "compaction"
  | "gadget-llm"
  | "gadget-decision"
  | "web-search";

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

/** One metered request: its raw provider cost and what incurred it. */
export type BillingCharge = {
  /** The provider's price for the request, in USD, before any markup. */
  rawCostUsd: number;
  /** What incurred the cost. */
  source: BillingUsageSource;
};

/** The account after a charge. */
export type BillingChargeResult = {
  /** The user's plan. */
  plan: BillingPlan;
  /** The remaining balance in USD after the charge. */
  balanceUsd: number;
  /** What was deducted, in USD: the raw cost times the markup, or 0 on the internal plan. */
  chargedUsd: number;
};

/** A user's balance and the ways they can add to it. */
export type BillingSummary = {
  /** The user's plan. */
  plan: BillingPlan;
  /** The remaining balance in USD. */
  balanceUsd: number;
  /** What a standard user pays per dollar of raw model cost; 1 on the internal plan. */
  markup: number;
  /** The top-up amounts offered, in USD. */
  topUpTiersUsd: number[];
  /** Whether online top-up is configured (Stripe keys present). */
  topUpEnabled: boolean;
};

/** How a ledger entry moved money. */
export type BillingLedgerKind = "topup" | "grant" | "refund" | "dispute";

/** One movement of money into or out of a balance, other than usage. */
export type BillingLedgerEntry = {
  /** Stable id of the entry. */
  id: string;
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

/** One day's metered usage from one source. */
export type BillingUsageDay = {
  /** The UTC day, YYYY-MM-DD. */
  day: string;
  /** What incurred the cost. */
  source: BillingUsageSource;
  /** The raw provider cost in USD. */
  rawCostUsd: number;
  /** What was deducted in USD. */
  chargedUsd: number;
  /** How many requests were metered. */
  requests: number;
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
  /** When the account was created, in epoch milliseconds. */
  createdAt: number;
  /** When the account last changed, in epoch milliseconds. */
  updatedAt: number;
};

/** One user's view of their own billing, scoped to that user when minted. */
export interface BillingUserApi {
  /** The user's balance, plan and top-up options. */
  getSummary(): Promise<BillingSummary>;
  /** The user's top-ups, grants and refunds, newest first. */
  listLedger(limit?: number): Promise<BillingLedgerEntry[]>;
  /** The user's metered usage for the last `days` UTC days, newest first. */
  listUsage(days?: number): Promise<BillingUsageDay[]>;
  /** Start a Stripe Checkout for one of the offered tiers; returns the page to send the user to. */
  createCheckout(tierUsd: number): Promise<{ url: string }>;
}

/** Deployment-admin operations on any user's billing. */
export interface BillingAdminApi {
  /** Accounts whose user key contains `query`, most recently changed first. */
  listAccounts(query?: string): Promise<BillingAccountInfo[]>;
  /**
   * Move a user to `plan`, creating their account if they have none yet. The Workshop records the
   * change in its admin audit log before calling.
   */
  setPlan(userKey: string, plan: BillingPlan): Promise<BillingAccountInfo>;
  /** Add `amountUsd` (negative to take some back) to a user's balance, with the admin's reason. */
  grant(userKey: string, amountUsd: number, note: string, actor: string): Promise<BillingAccountInfo>;
  /** A user's ledger, newest first. */
  listLedger(userKey: string, limit?: number): Promise<BillingLedgerEntry[]>;
}

/**
 * The billing Worker's entrypoint, as the Workshop reaches it over the BILLING service binding.
 * `userKey` is the user's profile id throughout.
 */
export interface BillingService {
  /** Whether the user may start paid work; creates a standard account on first sight. */
  authorize(userKey: string): Promise<BillingAuthorization>;
  /** Meter one request against the user. */
  charge(userKey: string, charge: BillingCharge): Promise<BillingChargeResult>;
  /** The user's own billing capability. */
  forUser(userKey: string): Promise<BillingUserApi>;
  /** The admin capability. The Workshop mints it only for deployment admins. */
  admin(): Promise<BillingAdminApi>;
}
