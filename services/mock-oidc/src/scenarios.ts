/**
 * Deterministic broker test scenarios. Each maps to a button on the picker page
 * and a distinct downstream outcome the Keycloak → BFF chain must handle.
 */
export const SCENARIOS = [
  "verified",
  "unverified",
  "denied",
  "provider-error",
  "disabled",
] as const;

export type Scenario = (typeof SCENARIOS)[number];

export function isScenario(value: unknown): value is Scenario {
  return typeof value === "string" && (SCENARIOS as readonly string[]).includes(value);
}

interface ScenarioMeta {
  label: string;
  description: string;
  /** "account" → finish login with a user; "error" → finish with an OAuth error. */
  kind: "account" | "error";
  /** OAuth error code returned to Keycloak for kind: "error". */
  errorCode?: string;
  errorDescription?: string;
}

export const SCENARIO_META: Record<Scenario, ScenarioMeta> = {
  verified: {
    label: "Verified user (success)",
    description: "A normal user with a verified email — login succeeds end-to-end.",
    kind: "account",
  },
  unverified: {
    label: "Unverified email",
    description: "email_verified=false — the BFF callback must reject this login.",
    kind: "account",
  },
  denied: {
    label: "Denied / cancelled",
    description: "User cancels at the provider — returns access_denied.",
    kind: "error",
    errorCode: "access_denied",
    errorDescription: "User denied or cancelled the login at the provider.",
  },
  "provider-error": {
    label: "Provider error",
    description: "Upstream provider failure — returns temporarily_unavailable.",
    kind: "error",
    errorCode: "temporarily_unavailable",
    errorDescription: "The upstream identity provider failed to process the request.",
  },
  disabled: {
    label: "Disabled account",
    description: "The provider refuses a disabled account — returns access_denied.",
    kind: "error",
    errorCode: "access_denied",
    errorDescription: "This account is disabled at the identity provider.",
  },
};
