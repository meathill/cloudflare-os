import { describe, expect, it } from "vitest";
import { getModel, isRuntimeModel } from "../src/ai-models.js";
import { assertGatewayProvider } from "../src/ai-gateway.js";

const USER = { type: "user" as const, id: "a@x.com", name: "A" };
const CONFIG = { provider: "google-vertex", model: "gemini-4-hydrogen", apiToken: "" };

function env(overrides: Partial<Cloudflare.Env> = {}): Cloudflare.Env {
  return {
    CF_AI_GATEWAY: "platform-gateway",
    CF_AI_GATEWAY_ACCOUNT_ID: "gateway-account-id",
    CF_AI_GATEWAY_API_TOKEN: "gateway-token",
    CF_AI_GATEWAY_PROVIDERS: "google,google-vertex",
    GCP_VERTEX_PROJECT: "meathill",
    ...overrides,
  } as Cloudflare.Env;
}

describe("Google Vertex AI provider", () => {
  it("rides the gateway's google-vertex-ai route at the project's URL, priced like Gemini", () => {
    const handle = getModel(env(), CONFIG, USER);
    expect(handle.model).toMatchObject({
      api: "google-generative-ai",
      provider: "google-vertex",
      baseUrl: "https://gateway.ai.cloudflare.com/v1/gateway-account-id/platform-gateway"
          + "/google-vertex-ai/v1/projects/meathill/locations/global/publishers/google",
    });
    // 与 google 同一套时段价目表（gemini-pricing.ts）。
    expect(handle.model.cost).toMatchObject({ input: expect.any(Number), output: expect.any(Number) });
  });

  it("defaults the location to global, where the project's Gemini models actually serve", () => {
    const handle = getModel(env(), CONFIG, USER);
    expect(handle.model.baseUrl).toContain("/locations/global/");
    // 文档列的区域（us-central1 等）实测对 Gemini 全部 404；project/location 只进 URL。
    expect(handle.model.baseUrl).not.toContain("us-central1");
  });

  it("exposes only the models verified to run, and serves none of them without a gateway", () => {
    expect(isRuntimeModel("google-vertex", "gemini-4-hydrogen")).toBe(true);
    expect(isRuntimeModel("google-vertex", "gemini-3.8-flash")).toBe(true);
    expect(isRuntimeModel("google-vertex", "gemini-3.1-pro-preview")).toBe(true);
    // gemini-4-carbon 需要更高的 GCP 结算等级（403），不在白名单里。
    expect(isRuntimeModel("google-vertex", "gemini-4-carbon")).toBe(false);
    expect(isRuntimeModel("google-vertex", "unknown")).toBe(false);

    expect(() => getModel(env({ CF_AI_GATEWAY: undefined }), CONFIG, USER))
        .toThrow("Vertex AI models run only through an AI Gateway.");
  });

  it("is a gateway-served provider, but never routed via a user's own gateway", () => {
    expect(() => assertGatewayProvider("google-vertex")).not.toThrow();

    expect(() => getModel(env(), CONFIG, USER, {
      userGateway: { accountId: "user-account-id", apiKey: "user-key" },
    })).toThrow("not supported via unified billing");
  });
});
