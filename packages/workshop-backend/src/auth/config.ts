// Configuration for sign-in via authentication gatekeepers (an optional, additive login feature).
//
// Authentication is provided by gatekeepers (e.g. "google", "github", "cloudflare") that advertise
// `providesAuth`. A deployment opts specific gatekeepers into the login UI via the AUTH_GATEKEEPERS
// allowlist (comma-separated vendor ids). When set, each listed, auth-capable gatekeeper gets a
// "Continue with ..." button alongside the normal username/password form (unless password auth is
// disabled). All OFF by default.

import { emailEnabled } from "../email.js";

/**
 * Parse the AUTH_GATEKEEPERS allowlist into a list of gatekeeper vendor ids (lowercased). These are
 * the gatekeepers permitted to drive sign-in; a vendor must also actually advertise `providesAuth`
 * to be offered. Empty when unset.
 */
export function getAuthGatekeeperAllowlist(env: Cloudflare.Env): string[] {
  const raw = (env as { AUTH_GATEKEEPERS?: string }).AUTH_GATEKEEPERS;
  if (!raw) return [];
  return raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}

/** Whether the deployment has opted any gatekeeper into sign-in. */
export function hasAuthGatekeepers(env: Cloudflare.Env): boolean {
  return getAuthGatekeeperAllowlist(env).length > 0;
}

/**
 * Parse SIGNUP_ALLOWLIST into lowercased email entries: a JSON array, or the same as a JSON string
 * (a secret binding's form), or a comma-separated string. An empty list turns the allowlist off.
 */
export function getSignupAllowlist(env: Cloudflare.Env): string[] {
  let raw: unknown = env.SIGNUP_ALLOWLIST;
  if (!raw) return [];
  let entries: unknown = raw;
  if (typeof raw === "string") {
    try {
      entries = JSON.parse(raw);
    } catch {
      entries = raw.split(",");
    }
  }
  if (!Array.isArray(entries)) return [];
  return entries
      .filter((entry): entry is string => typeof entry === "string")
      .map(entry => entry.trim().toLowerCase())
      .filter(Boolean);
}

/** Whether the deployment restricts account creation to its email allowlist. */
export function signupAllowlistEnabled(env: Cloudflare.Env): boolean {
  return getSignupAllowlist(env).length > 0;
}

/**
 * Whether `name` may create an account: always without an allowlist, and only when listed with one.
 * First sign-in and OTP registration pass an email; password accounts have no email, so enabling
 * the allowlist closes password signup entirely (see createAccount()).
 */
export function isSignupAllowed(env: Cloudflare.Env, name: string): boolean {
  let allowlist = getSignupAllowlist(env);
  if (allowlist.length === 0) return true;
  return allowlist.includes(name.trim().toLowerCase());
}

/**
 * Whether the user `name` is one of the deployment admins the ADMINS binding lists. Names match
 * regardless of the case of ASCII letters, as Cloudflare Access matches its email rules: the
 * list is typed by hand, while a sign-in names its user by the email as the identity provider
 * spells it, or by a password username, which is stored lowercased.
 */
export function isDeploymentAdmin(env: Cloudflare.Env, name: string): boolean {
  let admins: unknown = env.ADMINS;
  if (!admins) return false;

  if (typeof admins === "string") {
    // Admins should be a JSON binding of array type, but `.env` doesn't actually let you
    // specify JSON bindings, so we also support a string that parses as JSON array.
    admins = JSON.parse(admins);
  }

  if (!Array.isArray(admins)) {
    throw new TypeError("ADMINS must be configured as an array of usernames.");
  }

  let lowered = asciiLowerCase(name);
  return admins.some(admin => typeof admin === "string" && asciiLowerCase(admin) === lowered);
}

// Only ASCII letters are folded: toLowerCase() also folds some other characters onto ASCII ones,
// such as the Kelvin sign onto "k", which would let a look-alike name match an admin's.
const asciiLowerCase = (text: string) => text.replace(/[A-Z]/g, letter => letter.toLowerCase());

/** Whether email-code sign-in is on: EMAIL_OTP_ENABLED=true and an email channel to send codes. */
export function isEmailOtpEnabled(env: Cloudflare.Env): boolean {
  return env.EMAIL_OTP_ENABLED === "true" && emailEnabled(env);
}

/**
 * Whether username/password login + signup is available. Enabled by default. An installation can
 * set DISABLE_PASSWORD_AUTH=true to sign in only through auth gatekeepers or email codes — but that
 * only takes effect when one of them is available, otherwise we'd lock everyone out, so password
 * auth stays on.
 */
export function isPasswordAuthEnabled(env: Cloudflare.Env): boolean {
  if (env.DISABLE_PASSWORD_AUTH !== "true") return true;
  return !hasAuthGatekeepers(env) && !isEmailOtpEnabled(env);
}

/**
 * Whether new password accounts may be created. Password accounts carry no email, so wherever an
 * email can register instead -- email codes, or an allowlist deciding by address -- signup goes
 * through email alone. Existing password accounts keep signing in per isPasswordAuthEnabled().
 */
export function isPasswordSignupEnabled(env: Cloudflare.Env): boolean {
  return isPasswordAuthEnabled(env) && !isEmailOtpEnabled(env) && !signupAllowlistEnabled(env);
}
