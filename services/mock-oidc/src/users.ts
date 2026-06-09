/**
 * Deterministic fixture users. Account IDs are stable so the brokered Keycloak
 * user (and downstream platform identity) is reproducible across runs.
 *
 * Only "account" scenarios resolve to a user; error scenarios never mint a token.
 */
import type { ProviderKey } from "./config.ts";
import type { Scenario } from "./scenarios.ts";

export interface FixtureClaims {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  preferred_username: string;
}

const PROVIDER_LABEL: Record<ProviderKey, string> = {
  google: "Google",
  azure: "Microsoft",
  apple: "Apple",
};

/** Stable account id encodes provider + scenario, e.g. "mock-google-verified". */
export function accountId(provider: ProviderKey, scenario: Scenario): string {
  return `mock-${provider}-${scenario}`;
}

export function claimsFor(provider: ProviderKey, scenario: Scenario): FixtureClaims {
  const label = PROVIDER_LABEL[provider];
  const unverified = scenario === "unverified";
  const local = unverified ? "unverified" : "verified";
  return {
    sub: accountId(provider, scenario),
    email: `${local}.${provider}@mock-idp.test`,
    email_verified: !unverified,
    name: `${label} ${unverified ? "Unverified" : "Verified"} User`,
    preferred_username: `${local}.${provider}`,
  };
}
