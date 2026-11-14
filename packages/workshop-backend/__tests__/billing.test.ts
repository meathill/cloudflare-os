import { describe, expect, it, vi } from "vitest";
import type { BillingAuthorization, BillingChargeResult } from "@gadgets/workshop-shared/billing";
import {
  assertBillingAllowed, balanceExhausted, BillingRefusedError, billingEnabled, billingPayer,
  chargeBilling,
} from "../src/billing.js";

type FakeBilling = {
  authorize: (userKey: string) => Promise<BillingAuthorization>;
  charge: (userKey: string, charge: { rawCostUsd: number; source: string }) => Promise<BillingChargeResult>;
};

function env(billing?: Partial<FakeBilling>): Cloudflare.Env {
  return (billing ? { BILLING: billing } : {}) as unknown as Cloudflare.Env;
}

async function refusal(call: () => Promise<void>): Promise<string> {
  try {
    await call();
    return "ok";
  } catch (err) {
    expect(err).toBeInstanceOf(BillingRefusedError);
    return (err as Error).message;
  }
}

describe("billing hooks", () => {
  it("bill the user, or the owner of the gadget that spawned the agent, but never an agent", () => {
    expect(billingPayer({ type: "user", id: "a@x.com", name: "A" })).toBe("a@x.com");
    expect(billingPayer({ type: "gadget", id: "owner@x.com", name: "Gadget" })).toBe("owner@x.com");
    expect(billingPayer({ type: "agent", id: "gemini-3.8-flash", name: "Gemini" })).toBeUndefined();
  });

  it("do nothing without a BILLING binding", async () => {
    expect(billingEnabled(env())).toBe(false);
    expect(await refusal(() => assertBillingAllowed(env(), "a@x.com"))).toBe("ok");
    expect(await chargeBilling(env(), "a@x.com", 1, "chat")).toBeNull();
  });

  it("refuse a payer whose balance is spent", async () => {
    let billing = env({
      authorize: async () => ({ allowed: false, reason: "余额不足，请先充值。", plan: "standard", balanceUsd: 0 }),
    });
    expect(await refusal(() => assertBillingAllowed(billing, "a@x.com"))).toBe("余额不足，请先充值。");
    expect(await refusal(() => assertBillingAllowed(billing, undefined))).toBe("ok");
  });

  it("skip free requests and swallow a failed charge", async () => {
    let charge = vi.fn<FakeBilling["charge"]>(async () => { throw new Error("D1 down"); });
    let billing = env({ charge });
    expect(await chargeBilling(billing, "a@x.com", 0, "chat")).toBeNull();
    expect(charge).not.toHaveBeenCalled();
    expect(await chargeBilling(billing, "a@x.com", 0.01, "title")).toBeNull();
    expect(charge).toHaveBeenCalledWith("a@x.com", { rawCostUsd: 0.01, source: "title" });
  });

  it("treat only a spent standard balance as exhausted", () => {
    expect(balanceExhausted({ plan: "standard", balanceUsd: 0, chargedUsd: 0.2 })).toBe(true);
    expect(balanceExhausted({ plan: "standard", balanceUsd: 0.5, chargedUsd: 0.2 })).toBe(false);
    expect(balanceExhausted({ plan: "internal", balanceUsd: -3, chargedUsd: 0 })).toBe(false);
    expect(balanceExhausted(null)).toBe(false);
  });
});
