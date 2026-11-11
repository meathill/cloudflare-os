import { describe, expect, it } from "vitest";
import {
  getSignupAllowlist, isSignupAllowed, signupAllowlistEnabled,
} from "../src/auth/config.js";

function env(raw?: unknown): Cloudflare.Env {
  return (raw === undefined ? {} : { SIGNUP_ALLOWLIST: raw }) as unknown as Cloudflare.Env;
}

describe("SIGNUP_ALLOWLIST", () => {
  it("parses a JSON array, a JSON string, and a comma-separated list", () => {
    expect(getSignupAllowlist(env(["A@x.com", " b@y.com "]))).toEqual(["a@x.com", "b@y.com"]);
    expect(getSignupAllowlist(env('["a@x.com","b@y.com"]'))).toEqual(["a@x.com", "b@y.com"]);
    expect(getSignupAllowlist(env("a@x.com, b@y.com"))).toEqual(["a@x.com", "b@y.com"]);
  });

  it("is off when unset, empty, or malformed", () => {
    expect(signupAllowlistEnabled(env())).toBe(false);
    expect(signupAllowlistEnabled(env(""))).toBe(false);
    expect(signupAllowlistEnabled(env("[]"))).toBe(false);
    expect(signupAllowlistEnabled(env(3))).toBe(false);
  });

  it("allows any name while off, and only listed emails while on", () => {
    expect(isSignupAllowed(env(), "a@x.com")).toBe(true);
    const allowlisted = env("A@X.com");
    expect(signupAllowlistEnabled(allowlisted)).toBe(true);
    expect(isSignupAllowed(allowlisted, " a@x.com ")).toBe(true);
    expect(isSignupAllowed(allowlisted, "c@z.com")).toBe(false);
  });
});
