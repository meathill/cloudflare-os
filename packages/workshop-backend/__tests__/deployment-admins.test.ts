import { describe, expect, it } from "vitest";
import { isDeploymentAdmin } from "../src/auth/config.js";

const withAdmins = (admins: unknown, environment?: "development" | "test") =>
    ({ ADMINS: admins, WORKSHOP_ENVIRONMENT: environment }) as unknown as Cloudflare.Env;

describe("isDeploymentAdmin", () => {
  it("matches an email account's name regardless of case", () => {
    let env = withAdmins(["Jane.Doe@Example.com"]);
    expect(isDeploymentAdmin(env, "jane.doe@example.com")).toBe(true);
    expect(isDeploymentAdmin(env, "JANE.DOE@EXAMPLE.COM")).toBe(true);
    expect(isDeploymentAdmin(env, "someone@example.com")).toBe(false);
  });

  it("matches a password account only through an address it has verified", () => {
    let env = withAdmins(["jane@example.com"]);
    expect(isDeploymentAdmin(env, "jane")).toBe(false);
    expect(isDeploymentAdmin(env, "jane", [])).toBe(false);
    expect(isDeploymentAdmin(env, "jane", ["other@example.com"])).toBe(false);
    expect(isDeploymentAdmin(env, "jane", ["other@example.com", "Jane@Example.com"])).toBe(true);
  });

  it("never matches a username the list names on a deployment", () => {
    let env = withAdmins(["admin", "jane@example.com"]);
    expect(isDeploymentAdmin(env, "admin")).toBe(false);
    expect(isDeploymentAdmin(env, "Admin", ["someone@example.com"])).toBe(false);
  });

  it("matches a listed username on a local instance", () => {
    for (let environment of ["development", "test"] as const) {
      let env = withAdmins(["admin"], environment);
      expect(isDeploymentAdmin(env, "Admin")).toBe(true);
      expect(isDeploymentAdmin(env, "someone")).toBe(false);
    }
  });

  it("folds only ASCII letters, so a look-alike character matches no admin", () => {
    // The Kelvin sign lowercases to "k" under toLowerCase().
    let env = withAdmins(["kim@example.com"]);
    expect(isDeploymentAdmin(env, "\u212Aim@example.com")).toBe(false);
    expect(isDeploymentAdmin(env, "Kim@example.com")).toBe(true);
  });

  it("reads a list given as a JSON string", () => {
    let env = withAdmins(JSON.stringify(["Admin@Example.com"]));
    expect(isDeploymentAdmin(env, "admin@example.com")).toBe(true);
  });

  it("never takes an empty or absent name for an admin", () => {
    let env = withAdmins([""]);
    expect(isDeploymentAdmin(env, "")).toBe(false);
    expect(isDeploymentAdmin(env, undefined)).toBe(false);
  });

  it("names no admin while the binding is unset, and refuses one that is not a list", () => {
    expect(isDeploymentAdmin(withAdmins(undefined), "admin@example.com")).toBe(false);
    expect(() => isDeploymentAdmin(withAdmins(JSON.stringify({ admin: true })), "admin@example.com"))
        .toThrow("ADMINS must be configured as an array of usernames.");
  });
});
