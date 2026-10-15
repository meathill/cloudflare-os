export type DoLocationHint =
  | "apac-ne"
  | "apac-se"
  | "apac"
  | "weur"
  | "eeur"
  | "wnam"
  | "enam"
  | "sam"
  | "oc"
  | "afr"
  | "me";

/**
 * Resolves the Durable Object location hint for placing stateful DO instances
 * (UserDurableObject, OverseerDurableObject, AdminSettings, PendingLogin).
 * Defaults to "apac-ne" (Northeast Asia: Osaka, Tokyo, Seoul) closest to China.
 */
export function getDoLocationHint(env?: { DO_LOCATION_HINT?: string } | Record<string, unknown> | null): DoLocationHint | undefined {
  const hint = typeof env === "object" && env !== null && "DO_LOCATION_HINT" in env && typeof env.DO_LOCATION_HINT === "string"
    ? env.DO_LOCATION_HINT.trim()
    : undefined;
  if (hint) {
    return hint as DoLocationHint;
  }
  return "apac-ne";
}

/**
 * Convenience helper to produce options for DurableObjectNamespace.get(...)
 */
export function getDoOptions(env?: { DO_LOCATION_HINT?: string } | Record<string, unknown> | null): { locationHint?: DoLocationHint } | undefined {
  const hint = getDoLocationHint(env);
  return hint ? { locationHint: hint } : undefined;
}
