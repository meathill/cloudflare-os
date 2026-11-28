import { describe, expect, it, vi } from "vitest";
import { emailEnabled, escapeHtml, sendEmail } from "../src/email.js";

const MESSAGE = { to: "a@example.com", subject: "s", text: "t", html: "<p>h</p>" };

function configured(patch: Record<string, unknown> = {}): Cloudflare.Env {
  return {
    INVITE_EMAIL: { send: vi.fn(async () => ({ messageId: "m-1" })) },
    PUBLIC_BASE_URL: "https://writer.example/",
    ...patch,
  } as unknown as Cloudflare.Env;
}

describe("sendEmail", () => {
  it("sends from the product's no-reply address by default", async () => {
    const env = configured();
    expect(emailEnabled(env)).toBe(true);
    expect(await sendEmail(env, MESSAGE)).toBe(true);
    expect(env.INVITE_EMAIL!.send).toHaveBeenCalledWith({
      ...MESSAGE, from: "no-reply@xiaoniaoshuo.com",
    });
  });

  it("uses INVITE_EMAIL_FROM when configured", async () => {
    const env = configured({ INVITE_EMAIL_FROM: "invite@brand.example" });
    expect(await sendEmail(env, MESSAGE)).toBe(true);
    expect(env.INVITE_EMAIL!.send).toHaveBeenCalledWith({
      ...MESSAGE, from: "invite@brand.example",
    });
  });

  it("sends nothing without the binding", async () => {
    const env = configured({ INVITE_EMAIL: undefined });
    expect(emailEnabled(env)).toBe(false);
    expect(await sendEmail(env, MESSAGE)).toBe(false);
  });

  it("is enabled by the binding alone: no public origin is needed to send", async () => {
    const env = configured({ PUBLIC_BASE_URL: undefined });
    expect(emailEnabled(env)).toBe(true);
    expect(await sendEmail(env, MESSAGE)).toBe(true);
  });

  it("reports a refused send without throwing", async () => {
    const env = configured({
      INVITE_EMAIL: { send: vi.fn(async () => { throw new Error("refused"); }) },
    });
    expect(await sendEmail(env, MESSAGE)).toBe(false);
  });
});

describe("escapeHtml", () => {
  it("escapes the characters an interpolated value must not carry", () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`))
        .toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;");
  });
});
