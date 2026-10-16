import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateCost } from "@earendil-works/pi-ai";
import {
  isGeminiPromoPeriod,
  getGoogleModelCost,
  estimateTokenCost,
  GEMINI_3_8_FLASH_FALLBACK,
} from "../src/gemini-pricing.ts";

describe("gemini-pricing", () => {
  it("correctly identifies the promo period ending on 2026-12-31", () => {
    // 2026-10-16 当前时间
    assert.equal(isGeminiPromoPeriod(new Date("2026-10-16T12:00:00Z")), true);
    // 2026-12-31 最后一刻
    assert.equal(isGeminiPromoPeriod(new Date("2026-12-31T23:59:59.000Z")), true);
    // 2027-01-01 起恢复原价
    assert.equal(isGeminiPromoPeriod(new Date("2027-01-01T00:00:00.000Z")), false);
    assert.equal(isGeminiPromoPeriod(new Date("2027-06-15T08:00:00Z")), false);
  });

  it("calculates Gemini 3.8 Flash half-price rates in 2026 and standard rates in 2027", () => {
    const cost2026 = getGoogleModelCost("gemini-3.8-flash", new Date("2026-10-16T00:00:00Z"));
    assert.deepEqual(cost2026, {
      input: 0.75,
      output: 3.75,
      cacheRead: 0.075,
      cacheWrite: 0,
    });

    const cost2027 = getGoogleModelCost("gemini-3.8-flash", new Date("2027-01-01T00:00:00Z"));
    assert.deepEqual(cost2027, {
      input: 1.50,
      output: 7.50,
      cacheRead: 0.15,
      cacheWrite: 0,
    });
  });

  it("calculates Gemini 3.6 Flash rates correctly", () => {
    const cost2026 = getGoogleModelCost("gemini-3.6-flash", new Date("2026-10-16T00:00:00Z"));
    assert.equal(cost2026.input, 0.75);
    assert.equal(cost2026.output, 3.75);
    assert.equal(cost2026.cacheRead, 0.075);

    const cost2027 = getGoogleModelCost("gemini-3.6-flash", new Date("2027-02-01T00:00:00Z"));
    assert.equal(cost2027.input, 1.50);
    assert.equal(cost2027.output, 7.50);
    assert.equal(cost2027.cacheRead, 0.15);
  });

  it("calculates Gemini 2.5 Flash rates correctly", () => {
    const cost = getGoogleModelCost("gemini-2.5-flash");
    assert.deepEqual(cost, {
      input: 0.30,
      output: 2.50,
      cacheRead: 0.03,
      cacheWrite: 0,
    });
  });

  it("integrates seamlessly with pi-ai calculateCost for input, output and cached tokens", () => {
    const cost2026 = getGoogleModelCost("gemini-3.8-flash", new Date("2026-10-16T00:00:00Z"));
    const mockModel: any = {
      type: "chat",
      id: "gemini-3.8-flash",
      api: "google-generative-ai",
      provider: "google",
      cost: cost2026,
    };

    const usage: any = {
      input: 10_000,
      output: 2_000,
      cacheRead: 5_000,
      cacheWrite: 0,
      totalTokens: 17_000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };

    const calculated = calculateCost(mockModel, usage);

    // input: 10,000 * 0.75 / 1M = 0.0075
    // output: 2,000 * 3.75 / 1M = 0.0075
    // cacheRead: 5,000 * 0.075 / 1M = 0.000375
    // total: 0.0075 + 0.0075 + 0.000375 = 0.015375
    assert.ok(Math.abs(calculated.input - 0.0075) < 1e-6);
    assert.ok(Math.abs(calculated.output - 0.0075) < 1e-6);
    assert.ok(Math.abs(calculated.cacheRead - 0.000375) < 1e-6);
    assert.ok(Math.abs(calculated.total - 0.015375) < 1e-6);
    assert.ok(calculated.total > 0);
  });

  it("estimates token cost for historical uncosted records", () => {
    // 100,000 tokens @ $1.35/1M in 2026 = $0.135
    const cost2026 = estimateTokenCost(100_000, new Date("2026-10-16T00:00:00Z"));
    assert.ok(Math.abs(cost2026 - 0.135) < 1e-4);

    // 针对截图中历史用户真实用量进行校准测试：
    // meathill: 107,100 tokens -> 约 $0.144585
    const meathillCost = estimateTokenCost(107_100, new Date("2026-10-16T00:00:00Z"));
    assert.ok(meathillCost > 0.14 && meathillCost < 0.15);

    // sixiao: 198,227 tokens -> 约 $0.267606
    const sixiaoCost = estimateTokenCost(198_227, new Date("2026-10-16T00:00:00Z"));
    assert.ok(sixiaoCost > 0.26 && sixiaoCost < 0.27);

    // 100,000 tokens @ $2.70/1M in 2027 = $0.27
    const cost2027 = estimateTokenCost(100_000, new Date("2027-01-01T00:00:00Z"));
    assert.ok(Math.abs(cost2027 - 0.27) < 1e-4);

    assert.equal(estimateTokenCost(0), 0);
    assert.equal(estimateTokenCost(-500), 0);
  });

  it("provides fallback definitions for gemini-3.8-flash", () => {
    assert.equal(GEMINI_3_8_FLASH_FALLBACK.maxTokens, 65536);
    assert.equal(GEMINI_3_8_FLASH_FALLBACK.contextWindow, 1048576);
    assert.equal(GEMINI_3_8_FLASH_FALLBACK.reasoning, true);
  });
});
