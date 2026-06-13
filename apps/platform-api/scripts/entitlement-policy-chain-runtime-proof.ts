/**
 * Entitlement policy-chain runtime proof (ADR-0058 / ADR-ACT-0254).
 *
 * Pure proof: exercises the entitlement → policy → quota tail of the ADR-0058
 * evaluation chain (session → tenant → route-scope → permission → ENTITLEMENT →
 * policy → quota) against an in-memory repository. No live infrastructure.
 *
 * Proves: deny-by-default ordering (permission before entitlement), no-entitlement
 * denies, granted+permitted allows, and the quota step is a Phase-1 HOOK that never
 * enforces (status is always "not_enforced"/"not_applicable" — Phase 2 is ADR-0057).
 *
 * Usage: npm run proof:entitlement-policy-chain
 */

import type { AuditEvent, AuditEventPort } from "@platform/audit-events";
import { evaluateEntitlement, quotaHook, setEntitlement } from "../src/usecases/entitlements.ts";
import type {
  EntitlementGrantRecord,
  EntitlementRepository,
  UpsertEntitlementInput,
} from "../src/ports/entitlement-repository.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function makeInMemoryRepo(): EntitlementRepository {
  const store = new Map<string, EntitlementGrantRecord>();
  const key = (org: string, k: string) => `${org}:${k}`;
  return {
    listForTenant: async (org) => [...store.values()].filter((r) => r.organisationId === org),
    listForTenantAsOperator: async (org) =>
      [...store.values()].filter((r) => r.organisationId === org),
    getGrant: async (org, k) => store.get(key(org, k)) ?? null,
    upsert: async (input: UpsertEntitlementInput) => {
      const record: EntitlementGrantRecord = {
        organisationId: input.organisationId,
        entitlementKey: input.entitlementKey,
        state: input.state,
        source: input.source,
        metadata: input.metadata ?? {},
        updatedAt: "2026-06-13T00:00:00.000Z",
        updatedBy: input.updatedBy,
      };
      store.set(key(input.organisationId, input.entitlementKey), record);
      return record;
    },
  };
}

const noopAudit: AuditEventPort = {
  emit: async (_e: AuditEvent) => {},
  query: async () => [],
};

const ORG = "11111111-1111-1111-1111-111111111111";

async function main(): Promise<void> {
  console.log("# Entitlement policy-chain runtime proof (local-only, no infra)\n");

  const repo = makeInMemoryRepo();
  const deps = { repository: repo, audit: noopAudit };
  const actor = { actorId: "op-1", actorRoles: ["system_operator"] };

  // Chain step 1: missing permission denies BEFORE entitlement is consulted.
  {
    const r = await evaluateEntitlement(
      { organisationId: ORG, key: "webhooks", hasPermission: false },
      deps
    );
    check(
      "missing permission denies (chain stops at permission)",
      !r.allowed && r.decidedBy === "permission"
    );
  }

  // Chain step 2: permission present but not entitled → denied at entitlement.
  {
    const r = await evaluateEntitlement(
      { organisationId: ORG, key: "webhooks", hasPermission: true },
      deps
    );
    check(
      "permitted but not entitled → denied at entitlement",
      !r.allowed && r.decidedBy === "entitlement"
    );
  }

  // Grant, then chain allows; decision reaches the quota step.
  {
    await setEntitlement({ organisationId: ORG, key: "webhooks", state: "granted", actor }, deps);
    const r = await evaluateEntitlement(
      { organisationId: ORG, key: "webhooks", hasPermission: true },
      deps
    );
    check("permitted + entitled → allowed", r.allowed);
    check("allowed decision reaches the quota step", r.decidedBy === "quota");
  }

  // Quota hook is honest: never enforces in Phase 1.
  {
    const r = await evaluateEntitlement(
      { organisationId: ORG, key: "webhooks", hasPermission: true },
      deps
    );
    check("quota hook is not_enforced (Phase 1)", r.quota.status === "not_enforced");
    check("standalone quotaHook is honest no-op", quotaHook("webhooks").status === "not_enforced");
    check("unknown key quota is not_applicable", quotaHook("nope").status === "not_applicable");
  }

  // Revoke re-denies on the next evaluation (removed entitlement blocks access).
  {
    await setEntitlement({ organisationId: ORG, key: "webhooks", state: "revoked", actor }, deps);
    const r = await evaluateEntitlement(
      { organisationId: ORG, key: "webhooks", hasPermission: true },
      deps
    );
    check(
      "revoked entitlement re-denies at entitlement step",
      !r.allowed && r.decidedBy === "entitlement"
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
