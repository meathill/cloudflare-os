import { describe, expect, it } from "vitest";
import { DEFAULT_ADMIN_CONFIG, parseAdminConfig } from "../src/admin-config.js";
import { ambientGatekeeperMode } from "../src/provisioning-policy.js";

describe("ambientGatekeeperMode", () => {
  it("turns the drama engine on for every user until an admin chooses otherwise", () => {
    expect(ambientGatekeeperMode(DEFAULT_ADMIN_CONFIG, "custom")).toBe("enabled");
    expect(ambientGatekeeperMode(DEFAULT_ADMIN_CONFIG, "CUSTOM")).toBe("enabled");
    expect(ambientGatekeeperMode(parseAdminConfig("{}"), "custom")).toBe("enabled");
    expect(ambientGatekeeperMode(parseAdminConfig(
      JSON.stringify({ ambientGatekeeperModes: { scheduler: "optional" } }),
    ), "custom")).toBe("enabled");
    expect(ambientGatekeeperMode(DEFAULT_ADMIN_CONFIG, "context")).toBe("optional");
  });

  it("keeps an explicit admin choice for the drama engine", () => {
    let config = {
      ...DEFAULT_ADMIN_CONFIG,
      ambientGatekeeperModes: { custom: "disabled" as const },
    };
    expect(ambientGatekeeperMode(config, "custom")).toBe("disabled");
  });
});
