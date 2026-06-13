// ---------------------------------------------------------------------------
// Provider registry port (ADR-0055 / ADR-ACT-0254)
//
// The service catalog v2 seam: a capability defines a port; a provider is a
// concrete implementation registered against it with an environment
// classification, visibility (clickthrough policy), and isolation note. This
// port lets the catalog be sourced from a static seed today and a richer
// registry later, without changing consumers.
//
// Invariants enforced by the usecase layer:
//   - no entry exposes secrets or provider credentials;
//   - `not_exposed` entries are never listed to tenants; `global_only` is
//     system-admin only; `tenant_scoped_safe` may be shown to tenants;
//   - a `forbiddenInProduction` (mock) provider must never be the active
//     provider in a production environment.
// ---------------------------------------------------------------------------

import type { ServiceCatalogEntry } from "@platform/contracts-admin";

export interface ProviderRegistry {
  /** All catalog entries (operator/global view). Carries no secrets. */
  list(): readonly ServiceCatalogEntry[];
}
