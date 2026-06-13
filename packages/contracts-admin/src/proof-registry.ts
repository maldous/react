// ---------------------------------------------------------------------------
// Proof-ladder registry — the single source of truth for the repeatable local
// runtime proofs (`npm run proof:*`). Consumed by the /admin/platform cockpit
// (read-only index card), referenced by README/evidence, and reconciled against
// package.json scripts by a unit test (proof-registry.test.ts in platform-api).
//
// Add new proofs HERE (plus the package.json script + README mention); never
// hand-duplicate this list in UI components or docs tooling.
// ---------------------------------------------------------------------------

export const PROOF_LADDER = [
  "proof:auth-settings",
  "proof:auth-idps",
  "proof:auth-credential-lifecycle",
  "proof:auth-oidc-enterprise",
  "proof:email-sender",
  "proof:tenant-domains",
  "proof:tenant-storage",
  "proof:tenant-observability",
  "proof:webhooks",
  "proof:webhook-worker",
  "proof:tenant-domains-routing",
  "proof:webhook-redrive",
  "proof:platform-services",
  "proof:backup-local",
  "proof:domain-identity-matrix",
  "proof:tenant-custom-domain-resolution",
  "proof:tenant-domain-canonical",
  "proof:tenant-custom-domain-auth-origin",
  "proof:service-clickthrough-policy",
  "proof:tenant-domain-claim-lifecycle",
  "proof:entitlements",
  "proof:entitlement-policy-chain",
  "proof:service-catalog-registry",
  "proof:entitlements-postgres",
  "proof:entitlements-routes",
] as const;

export type ProofLadderEntry = (typeof PROOF_LADDER)[number];
