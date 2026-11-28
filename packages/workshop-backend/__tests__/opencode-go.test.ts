import { describe, expect, it } from "vitest";
import { getModel, OPENCODE_GO_BASE_URL, OPENCODE_GO_MODELS } from "../src/ai-models.js";

const USER = { type: "user" as const, id: "a@x.com", name: "A" };
const env = (key?: string) => ({ OPENCODE_API_KEY: key }) as unknown as Cloudflare.Env;

describe("OpenCode Go provider", () => {
  it("runs on Go's OpenAI-compatible endpoint, priced at the vendor's official rate", () => {
    const handle = getModel(env("go-key"), { provider: "opencode-go", model: "deepseek-v4.1-flash", apiToken: "" }, USER);
    expect(handle.model).toMatchObject({
      api: "openai-completions",
      baseUrl: OPENCODE_GO_BASE_URL,
      provider: "opencode-go",
      cost: OPENCODE_GO_MODELS["deepseek-v4.1-flash"]!.cost,
    });
    // DeepSeek's official peak price, not Go's off-peak subscription price.
    expect(handle.model.cost).toMatchObject({ input: 0.3, output: 1.2 });
  });

  it("refuses without a deployment key, and refuses a model it has no price for", () => {
    expect(() => getModel(env(), { provider: "opencode-go", model: "glm-5.3", apiToken: "" }, USER))
      .toThrow("OPENCODE_API_KEY");
    expect(() => getModel(env("go-key"), { provider: "opencode-go", model: "unpriced", apiToken: "" }, USER))
      .toThrow("没有官方价");
  });
});
