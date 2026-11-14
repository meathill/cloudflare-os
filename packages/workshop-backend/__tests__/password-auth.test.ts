import { describe, expect, it } from "vitest";
import { isEmailOtpEnabled, isPasswordAuthEnabled, isPasswordSignupEnabled } from "../src/auth/config.js";

function env(vars: Record<string, unknown>): Cloudflare.Env {
  return vars as unknown as Cloudflare.Env;
}

const EMAIL_BINDING = { send: async () => {} };

describe("isPasswordAuthEnabled", () => {
  it("stays on unless DISABLE_PASSWORD_AUTH is set", () => {
    expect(isPasswordAuthEnabled(env({ EMAIL_OTP_ENABLED: "true", INVITE_EMAIL: EMAIL_BINDING }))).toBe(true);
  });

  it("stays on when disabling it would leave no way to sign in", () => {
    expect(isPasswordAuthEnabled(env({ DISABLE_PASSWORD_AUTH: "true" }))).toBe(true);
    // Codes cannot be sent without the email binding, so they don't count.
    expect(isPasswordAuthEnabled(env({ DISABLE_PASSWORD_AUTH: "true", EMAIL_OTP_ENABLED: "true" }))).toBe(true);
  });

  it("turns off when email codes can sign users in", () => {
    let otpOnly = env({ DISABLE_PASSWORD_AUTH: "true", EMAIL_OTP_ENABLED: "true", INVITE_EMAIL: EMAIL_BINDING });
    expect(isEmailOtpEnabled(otpOnly)).toBe(true);
    expect(isPasswordAuthEnabled(otpOnly)).toBe(false);
  });

  it("turns off when an auth gatekeeper can sign users in", () => {
    expect(isPasswordAuthEnabled(env({ DISABLE_PASSWORD_AUTH: "true", AUTH_GATEKEEPERS: "google" }))).toBe(false);
  });
});

describe("isPasswordSignupEnabled", () => {
  it("is open by default", () => {
    expect(isPasswordSignupEnabled(env({}))).toBe(true);
  });

  it("closes while email codes can register, even with password login on", () => {
    let otp = env({ EMAIL_OTP_ENABLED: "true", INVITE_EMAIL: EMAIL_BINDING });
    expect(isPasswordAuthEnabled(otp)).toBe(true);
    expect(isPasswordSignupEnabled(otp)).toBe(false);
  });

  it("closes under a signup allowlist", () => {
    expect(isPasswordSignupEnabled(env({ SIGNUP_ALLOWLIST: "a@x.com" }))).toBe(false);
  });
});
