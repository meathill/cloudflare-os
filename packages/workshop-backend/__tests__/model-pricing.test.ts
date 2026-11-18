import { describe, expect, it } from "vitest";
import {
  SUGGESTED_MODELS, type AiChatAuthorInfo, type AiModelConfig, type AiModelProvider,
} from "@gadgets/workshop-shared/api";
import { getModel, modelPricing } from "../src/ai-models.js";

// 有缘心之助：模型目录就是计费的单价来源。目录里任何一个在售模型掉成 $0 单价，用量看板就会
// 悄悄失真，所以这里守住两件事：在售模型必须有单价，下架的型号必须仍可解析。

const INITIATOR: AiChatAuthorInfo = { type: "user", id: "user-123", name: "User" };

const env = {
  CF_AI_GATEWAY: "gateway",
  CF_AI_GATEWAY_ACCOUNT_ID: "gateway-account",
  CF_AI_GATEWAY_API_TOKEN: "gateway-token",
  CF_AI_GATEWAY_PROVIDERS: "anthropic,cloudflare,cloudflare-auto-router,google,openai",
} as unknown as Cloudflare.Env;

// 没有自己单价的目录项：Auto 按它实际挑中的模型计费，Ollama 跑在用户自己的机器上。
const UNPRICED_PROVIDERS = new Set<AiModelProvider>(["cloudflare-auto-router", "ollama"]);

// 已下架、但历史对话与定时任务仍可能引用的型号。
const RETIRED: [AiModelProvider, string][] = [
  ["cloudflare", "@cf/zai-org/glm-5.3-flash"],
  ["cloudflare", "@cf/deepseek-ai/deepseek-v4-pro-0813"],
  ["openai", "gpt-6-astra"],
  ["openai", "gpt-6.1-sol"],
  ["google", "gemini-3.6-flash"],
];

// 选择器在售的型号。
const OFFERED: [AiModelProvider, string][] = [
  ["cloudflare", "@cf/zai-org/glm-5.3"],
  ["cloudflare", "@cf/deepseek-ai/deepseek-v4.1-flash-1017"],
  ["openai", "gpt-6.2-sol"],
  ["openai", "gpt-6.2-astra"],
  ["openai", "gpt-6.1-terra"],
  ["openai", "gpt-6-luna"],
  ["google", "gemini-3.8-flash"],
  ["google", "gemini-4-hydrogen"],
  ["google", "gemini-4-argon"],
  ["google", "gemini-4-carbon"],
];

function cost(provider: AiModelProvider, model: string) {
  return getModel({ ...env, OPENCODE_API_KEY: "test" }, { provider, model, apiToken: "unused" }, INITIATOR).model.cost;
}

describe("模型目录计费", () => {
  it("prices every language model it offers", () => {
    for (const [provider, models] of Object.entries(SUGGESTED_MODELS)) {
      if (UNPRICED_PROVIDERS.has(provider as AiModelProvider)) continue;
      for (const [id, spec] of Object.entries(models)) {
        // 判断型模型没有输出 token，只有输入单价。
        if (spec.kind === "decision") continue;
        const where = `${provider}/${id}`;
        expect(cost(provider as AiModelProvider, id).input, `${where} 输入单价`).toBeGreaterThan(0);
        expect(cost(provider as AiModelProvider, id).output, `${where} 输出单价`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps retired models resolvable but hidden", () => {
    for (const [provider, id] of RETIRED) {
      expect(SUGGESTED_MODELS[provider][id]?.hidden, `${provider}/${id}`).toBe(true);
      expect(cost(provider, id).input, `${provider}/${id} 输入单价`).toBeGreaterThan(0);
    }
  });

  it.each(OFFERED)("offers %s/%s in the pickers", (provider, id) => {
    expect(SUGGESTED_MODELS[provider][id]?.hidden).toBeUndefined();
  });
});

describe("modelPricing 官方参考价", () => {
  const at = new Date("2026-11-18T00:00:00Z");
  const config = (provider: AiModelProvider, model: string): AiModelConfig =>
      ({ provider, model, apiToken: "unused" });

  it("gives a Google model the price of the day and the announced change", () => {
    const pricing = modelPricing(config("google", "gemini-4-argon"), at);
    expect(pricing?.price)
        .toEqual({ input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 });
    expect(pricing?.nextPrice).toEqual({
      from: "2026-12-01",
      price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 0 },
    });
    // Hydrogen 全窗口统一价，没有已公布的调价。
    expect(modelPricing(config("google", "gemini-4-hydrogen"), at)?.nextPrice).toBeUndefined();
    // 3.8 Flash 的半价到年底，调价日从 2027-01-01 起算（不是 12 月 31 日）。
    expect(modelPricing(config("google", "gemini-3.8-flash"), at)?.nextPrice?.from)
        .toBe("2027-01-01");
  });

  it("gives GPT-6.2 Sol its long-context tier", () => {
    expect(modelPricing(config("openai", "gpt-6.2-sol"), at)).toEqual({
      price: {
        input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5,
        longContext: {
          inputTokensAbove: 272_000, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5,
        },
      },
    });
  });

  it("prices an OpenCode Go model from the vendor table", () => {
    expect(modelPricing(config("opencode-go", "glm-5.3"), at)).toEqual({
      price: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
    });
  });

  it("lists no price for a model that only borrows runtime flags", () => {
    // behavesLike 借来的条目没有 cost：不会误报借来模型的价格。
    expect(modelPricing(
        { provider: "openai", model: "gpt-next", apiToken: "unused", behavesLike: "gpt-6.1-sol" },
        at)).toBeUndefined();
    expect(modelPricing(config("ollama", "qwen3:8b"), at)).toBeUndefined();
  });
});
