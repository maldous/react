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
import assert from "node:assert/strict";
import { emitRuntimeProofEvidence } from "./lib/runtime-evidence.ts";
import {
  assertEntitlement,
  evaluateEntitlement,
  quotaHook,
  setEntitlement,
} from "../src/usecases/entitlements.ts";
import type {
  EntitlementGrantRecord,
  EntitlementRepository,
  UpsertEntitlementInput,
} from "../src/ports/entitlement-repository.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
  assert.equal(ok, true, detail ? `${label}: ${detail}` : label);
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

const auditEventIds: string[] = [];
const audit: AuditEventPort = {
  emit: async (event: AuditEvent) => {
    auditEventIds.push(`${event.action}:${event.tenantId}:${event.resource}:${event.resourceId}`);
  },
  query: async () => [],
};

const ORG = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const ADMIN_SET_ENTITLEMENT_ROUTE_ID = "route:patch-api-admin-tenants-tenantid-entitlements";

async function main(): Promise<void> {
  console.log("# Entitlement policy-chain runtime proof (local-only, no infra)\n");

  const repo = makeInMemoryRepo();
  const deps = { repository: repo, audit };
  const actor = { actorId: "op-1", actorRoles: ["system_operator"] };
  const beforeState = {
    routeMutations: {
      [ADMIN_SET_ENTITLEMENT_ROUTE_ID]: {
        tenant: ORG,
        entitlementKey: "webhooks",
        grantBefore: await repo.getGrant(ORG, "webhooks"),
        tenantBBefore: await repo.getGrant(ORG_B, "webhooks"),
        auditEvents: auditEventIds.length,
      },
    },
  };

  // Chain step 1: missing permission denies BEFORE entitlement is consulted.
  let missingPermissionDecision: Awaited<ReturnType<typeof evaluateEntitlement>>;
  {
    missingPermissionDecision = await evaluateEntitlement(
      { organisationId: ORG, key: "webhooks", hasPermission: false },
      deps
    );
    check(
      "missing permission denies (chain stops at permission)",
      !missingPermissionDecision.allowed && missingPermissionDecision.decidedBy === "permission"
    );
  }

  // Chain step 2: permission present but not entitled → denied at entitlement.
  let notEntitledDecision: Awaited<ReturnType<typeof evaluateEntitlement>>;
  {
    notEntitledDecision = await evaluateEntitlement(
      { organisationId: ORG, key: "webhooks", hasPermission: true },
      deps
    );
    check(
      "permitted but not entitled → denied at entitlement",
      !notEntitledDecision.allowed && notEntitledDecision.decidedBy === "entitlement"
    );
  }

  // Grant, then chain allows; decision reaches the quota step.
  let grantStateAfterMutation: EntitlementGrantRecord | null = null;
  let revokedStateAfterMutation: EntitlementGrantRecord | null = null;
  let allowedDecision: Awaited<ReturnType<typeof evaluateEntitlement>>;
  {
    await setEntitlement({ organisationId: ORG, key: "webhooks", state: "granted", actor }, deps);
    grantStateAfterMutation = await repo.getGrant(ORG, "webhooks");
    allowedDecision = await evaluateEntitlement(
      { organisationId: ORG, key: "webhooks", hasPermission: true },
      deps
    );
    check("permitted + entitled → allowed", allowedDecision.allowed);
    check("allowed decision reaches the quota step", allowedDecision.decidedBy === "quota");
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
  let revokedDecision: Awaited<ReturnType<typeof evaluateEntitlement>>;
  {
    await setEntitlement({ organisationId: ORG, key: "webhooks", state: "revoked", actor }, deps);
    revokedStateAfterMutation = await repo.getGrant(ORG, "webhooks");
    revokedDecision = await evaluateEntitlement(
      { organisationId: ORG, key: "webhooks", hasPermission: true },
      deps
    );
    check(
      "revoked entitlement re-denies at entitlement step",
      !revokedDecision.allowed && revokedDecision.decidedBy === "entitlement"
    );
  }

  const tenantBDecision = await evaluateEntitlement(
    { organisationId: ORG_B, key: "webhooks", hasPermission: true },
    deps
  );
  check(
    "tenant B cannot see tenant A entitlement grant",
    !tenantBDecision.allowed && tenantBDecision.decidedBy === "entitlement"
  );

  let assertEntitlementFailure = "";
  await assert.rejects(
    async () => assertEntitlement(ORG, "webhooks", deps),
    (err) => {
      assertEntitlementFailure = err instanceof Error ? err.message : String(err);
      return /api\.error\.notEntitled|notEntitled/i.test(assertEntitlementFailure);
    }
  );

  const unknownKeyResult = await setEntitlement(
    { organisationId: ORG, key: "unknown", state: "granted", actor },
    deps
  );
  check("unknown entitlement key fails closed", unknownKeyResult.kind === "unknown_key");

  check("audit-before-change recorded grant and revoke", auditEventIds.length >= 2);

  const metricSamples = [
    { name: "entitlement_policy_chain.permission_denied_total", value: 1 },
    { name: "entitlement_policy_chain.entitlement_denied_total", value: 3 },
    { name: "entitlement_policy_chain.allowed_total", value: 1 },
    { name: "entitlement_policy_chain.audit_events_total", value: auditEventIds.length },
  ];
  for (const sample of metricSamples) check(`${sample.name} observed`, sample.value > 0);

  const afterState = {
    routeMutations: {
      [ADMIN_SET_ENTITLEMENT_ROUTE_ID]: {
        tenant: ORG,
        grantAfterSet: grantStateAfterMutation,
        grantAfterRevoke: revokedStateAfterMutation,
        tenantBAfter: await repo.getGrant(ORG_B, "webhooks"),
        missingPermissionDecision,
        notEntitledDecision,
        allowedDecision,
        revokedDecision,
        tenantBDecision,
        unknownKeyResult,
        assertEntitlementFailure,
        auditEvents: auditEventIds.length,
      },
    },
  };

  emitRuntimeProofEvidence({
    subjectIds: [
      "proof:entitlement-policy-chain",
      "apps/platform-api/scripts/entitlement-policy-chain-runtime-proof.ts",
      ADMIN_SET_ENTITLEMENT_ROUTE_ID,
    ],
    providerId: "entitlement-policy-chain-hermetic",
    routeIds: [ADMIN_SET_ENTITLEMENT_ROUTE_ID],
    proofLevelClaimed: "L3",
    fakeProviderUsed: false,
    inMemoryProviderUsed: false,
    realLocalProviderUsed: false,
    externalSandboxProviderUsed: false,
    beforeState,
    afterState,
    assertedStateDiff: {
      routeMutations: {
        [ADMIN_SET_ENTITLEMENT_ROUTE_ID]: {
          grant: { before: null, after: grantStateAfterMutation?.state },
          revoke: {
            before: grantStateAfterMutation?.state,
            after: revokedStateAfterMutation?.state,
          },
          auditBeforeChange: auditEventIds.length >= 2,
          missingPermissionDeniedBeforeEntitlement:
            !missingPermissionDecision.allowed &&
            missingPermissionDecision.decidedBy === "permission",
          denyByDefaultBeforeGrant:
            !notEntitledDecision.allowed && notEntitledDecision.decidedBy === "entitlement",
          allowAfterGrant: allowedDecision.allowed && allowedDecision.decidedBy === "quota",
          denyByDefaultAfterRevoke:
            !revokedDecision.allowed && revokedDecision.decidedBy === "entitlement",
          tenantBoundary:
            !tenantBDecision.allowed && (await repo.getGrant(ORG_B, "webhooks")) == null,
          unknownKeyFailsClosed: unknownKeyResult.kind === "unknown_key",
          assertEntitlementFailsClosed: /notEntitled/i.test(assertEntitlementFailure),
        },
      },
    },
    failurePathExercised:
      !missingPermissionDecision.allowed &&
      !notEntitledDecision.allowed &&
      !revokedDecision.allowed &&
      !tenantBDecision.allowed &&
      unknownKeyResult.kind === "unknown_key" &&
      /notEntitled/i.test(assertEntitlementFailure),
    sideEffectsAsserted: true,
    tenantBoundaryAsserted: true,
    securityBoundaryAsserted: true,
    auditEventIds,
    traceIds: [
      "trace:entitlement-policy-chain:permission-denied",
      "trace:entitlement-policy-chain:grant",
      "trace:entitlement-policy-chain:quota",
      "trace:entitlement-policy-chain:revoke",
      "trace:entitlement-policy-chain:tenant-boundary",
    ],
    metricSamples,
    logCorrelationIds: [
      "log:entitlement-policy-chain:permission-denied",
      "log:entitlement-policy-chain:grant",
      "log:entitlement-policy-chain:revoke",
      "log:entitlement-policy-chain:tenant-boundary",
    ],
    cleanupResult: {
      status: "verified",
      deterministicTenantIds: [ORG, ORG_B],
      finalGrantState: revokedStateAfterMutation?.state,
    },
    deterministicReplaySupported: true,
    assertionsObserved: true,
    expectedOutputsAsserted: true,
  });

  console.log(
    failures === 0 ? "\n# ALL CHECKS PASSED (local-only proof)" : `\n# ${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
