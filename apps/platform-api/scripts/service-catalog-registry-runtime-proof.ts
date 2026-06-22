/**
 * Service catalog registry runtime proof (ADR-0055 / ADR-ACT-0254).
 *
 * Pure proof over the static service-catalog seed + build/filter logic. No infra.
 *
 * Proves: every entry is fully classified (environment, visibility, decision,
 * isolation note, proof refs); the catalog carries no secrets; a mock/forbidden
 * provider is never selected in production; and tenant visibility filtering hides
 * not_exposed/global_only and entitlement-gated entries the tenant lacks.
 *
 * Usage: npm run proof:service-catalog-registry
 */

import {
  STATIC_PROVIDER_REGISTRY,
  buildServiceCatalog,
  forbiddenProvidersForEnvironment,
} from "../src/usecases/service-catalog.ts";
import assert from "node:assert/strict";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
  assert.equal(ok, true, detail ? `${label}: ${detail}` : label);
}

const VISIBILITIES = new Set(["tenant_scoped_safe", "global_only", "not_exposed"]);
const DECISIONS = new Set(["build", "compose", "adapter", "defer", "reject"]);
// Secret-bearing FIELD NAMES that must never appear on a catalog entry. (Prose in
// isolationNotes may legitimately discuss "secrets" — we check keys, not descriptions.)
const SECRET_FIELD = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;

async function main(): Promise<void> {
  console.log("# Service catalog registry runtime proof (local-only, no infra)\n");

  const entries = STATIC_PROVIDER_REGISTRY.list();
  check("catalog is non-empty", entries.length > 0, `${entries.length} entries`);

  // 1. Every entry is fully and validly classified.
  for (const e of entries) {
    check(`${e.serviceKey}: has service name + category`, !!e.serviceName && !!e.category);
    check(`${e.serviceKey}: environment model set`, !!e.environmentModel);
    check(`${e.serviceKey}: visibility is valid`, VISIBILITIES.has(e.visibility));
    check(`${e.serviceKey}: decision is valid`, DECISIONS.has(e.decision));
    check(`${e.serviceKey}: has isolation notes`, !!e.isolationNotes);
    check(`${e.serviceKey}: has at least one proof ref`, e.proofRefs.length > 0);
    check(
      `${e.serviceKey}: entitlement linkage is consistent`,
      e.requiresEntitlement ? !!e.entitlementKey : e.entitlementKey === null
    );
  }

  // 2. No secret-bearing FIELD NAMES on any entry (prose may discuss "secrets"; keys may not).
  {
    const offendingKeys = entries.flatMap((e) =>
      Object.keys(e).filter((k) => SECRET_FIELD.test(k))
    );
    check(
      "catalog entries carry no secret-bearing fields",
      offendingKeys.length === 0,
      offendingKeys.join(", ")
    );
  }

  // 3. Mock/forbidden providers must never be active in production.
  {
    const forbiddenProd = forbiddenProvidersForEnvironment("production");
    check(
      "production rejects mock/forbidden providers",
      forbiddenProd.length > 0 && forbiddenProd.every((e) => e.forbiddenInProduction)
    );
    check(
      "dev permits all providers",
      forbiddenProvidersForEnvironment("development").length === 0
    );
    // every mock-only entry must be flagged forbiddenInProduction
    const mocks = entries.filter((e) => e.environmentModel === "mock-only");
    check(
      "every mock-only entry is forbiddenInProduction",
      mocks.length > 0 && mocks.every((e) => e.forbiddenInProduction)
    );
  }

  // 4. Tenant visibility filtering (ADR-ACT-0233).
  {
    const operatorView = buildServiceCatalog({ operator: true });
    check("operator sees the full catalog", operatorView.services.length === entries.length);

    const tenantNoEntitlements = buildServiceCatalog({ operator: false, entitledKeys: new Set() });
    check(
      "tenant never sees not_exposed entries",
      tenantNoEntitlements.services.every((e) => e.visibility !== "not_exposed")
    );
    check(
      "tenant never sees global_only entries",
      tenantNoEntitlements.services.every((e) => e.visibility !== "global_only")
    );
    check(
      "tenant without entitlement does not see entitlement-gated services",
      tenantNoEntitlements.services.every((e) => !e.requiresEntitlement)
    );

    // A tenant_scoped_safe service that is NOT entitlement-gated is visible (keycloak).
    const tenantBaseline = buildServiceCatalog({ operator: false, entitledKeys: new Set() });
    check(
      "tenant sees a non-gated tenant_scoped_safe service",
      tenantBaseline.services.some((e) => e.serviceKey === "keycloak")
    );
  }

  console.log(
    failures === 0 ? "\n# ALL CHECKS PASSED (local-only proof)" : `\n# ${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
