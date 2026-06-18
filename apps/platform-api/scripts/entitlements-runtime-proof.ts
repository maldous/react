/**
 * Entitlements runtime proof (ADR-0057 / ADR-0058 / ADR-ACT-0254).
 *
 * Pure proof: exercises the entitlement usecase against an in-memory repository +
 * a capturing audit port. No live infrastructure required.
 *
 * Proves: deny-by-default, system-operator grant/revoke, audit-before-change,
 * removed entitlement blocks access, feature-flag ≠ entitlement, tenant-scoping.
 *
 * Usage: npm run proof:entitlements
 */

import { AuditAction, type AuditEvent, type AuditEventPort } from "@platform/audit-events";
import {
  isEntitled,
  listEntitlementsForTenant,
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

function makeCapturingAudit(): {
  port: AuditEventPort;
  events: AuditEvent[];
  failNext: () => void;
} {
  const events: AuditEvent[] = [];
  let shouldFail = false;
  return {
    events,
    failNext: () => {
      shouldFail = true;
    },
    port: {
      emit: async (e) => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error("audit backend unavailable");
        }
        events.push(e);
      },
      query: async () => events,
    },
  };
}

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const actor = { actorId: "op-1", actorRoles: ["system_operator"], sourceHost: "aldous.info" };

async function main(): Promise<void> {
  console.log("# Entitlements runtime proof (local-only, no infra)\n");

  // 1. Deny-by-default: nothing granted yet.
  {
    const repo = makeInMemoryRepo();
    const audit = makeCapturingAudit();
    const deps = { repository: repo, audit: audit.port };
    check(
      "deny-by-default: ungranted key is not entitled",
      !(await isEntitled(ORG_A, "webhooks", deps))
    );
    const list = await listEntitlementsForTenant(ORG_A, deps);
    const webhooks = list.entitlements.find((e) => e.key === "webhooks");
    check("ungranted key reads as not_granted", webhooks?.state === "not_granted");
  }

  // 2. System-operator grant works + is audited BEFORE the write.
  {
    const repo = makeInMemoryRepo();
    const audit = makeCapturingAudit();
    const deps = { repository: repo, audit: audit.port };
    const result = await setEntitlement(
      { organisationId: ORG_A, key: "webhooks", state: "granted", note: "pilot", actor },
      deps
    );
    check("grant returns ok", result.kind === "ok");
    check("granted key is entitled", await isEntitled(ORG_A, "webhooks", deps));
    check("grant emitted exactly one audit event", audit.events.length === 1);
    check(
      "audit action is entitlement.granted",
      audit.events[0]?.action === AuditAction.EntitlementGranted
    );
    check(
      "audit metadata carries no secret",
      JSON.stringify(audit.events[0]?.metadata ?? {})
        .toLowerCase()
        .indexOf("secret") === -1
    );
  }

  // 3. Audit-before-change: if the audit write fails, the grant must NOT persist.
  {
    const repo = makeInMemoryRepo();
    const audit = makeCapturingAudit();
    const deps = { repository: repo, audit: audit.port };
    audit.failNext();
    let threw = false;
    try {
      await setEntitlement(
        { organisationId: ORG_A, key: "storage", state: "granted", actor },
        deps
      );
    } catch {
      threw = true;
    }
    check("grant rejects when audit write fails", threw);
    check(
      "no entitlement persisted after failed audit",
      !(await isEntitled(ORG_A, "storage", deps))
    );
  }

  // 4. Revoke blocks access (removed entitlement blocks the capability).
  {
    const repo = makeInMemoryRepo();
    const audit = makeCapturingAudit();
    const deps = { repository: repo, audit: audit.port };
    await setEntitlement({ organisationId: ORG_A, key: "storage", state: "granted", actor }, deps);
    check("granted before revoke", await isEntitled(ORG_A, "storage", deps));
    const revoke = await setEntitlement(
      { organisationId: ORG_A, key: "storage", state: "revoked", actor },
      deps
    );
    check("revoke returns ok", revoke.kind === "ok");
    check("revoked entitlement blocks access", !(await isEntitled(ORG_A, "storage", deps)));
    check(
      "revoke emitted entitlement.revoked",
      audit.events.some((e) => e.action === AuditAction.EntitlementRevoked)
    );
  }

  // 5. Tenant scoping: ORG_A grant does not leak to ORG_B.
  {
    const repo = makeInMemoryRepo();
    const audit = makeCapturingAudit();
    const deps = { repository: repo, audit: audit.port };
    await setEntitlement({ organisationId: ORG_A, key: "webhooks", state: "granted", actor }, deps);
    check(
      "entitlement is tenant-scoped (B not entitled)",
      !(await isEntitled(ORG_B, "webhooks", deps))
    );
  }

  // 6. Unknown key is rejected (feature flags are not entitlements; only catalog keys exist).
  {
    const repo = makeInMemoryRepo();
    const audit = makeCapturingAudit();
    const deps = { repository: repo, audit: audit.port };
    const result = await setEntitlement(
      { organisationId: ORG_A, key: "some_feature_flag", state: "granted", actor },
      deps
    );
    check("unknown/flag key is rejected (flag ≠ entitlement)", result.kind === "unknown_key");
    check("no audit emitted for unknown key", audit.events.length === 0);
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
