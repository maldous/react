/**
 * Entitlements LIVE Postgres proof (ADR-0057 / ADR-0058 / ADR-ACT-0255).
 *
 * Proves the entitlement substrate end-to-end against the local Compose Postgres:
 * migration 022 ran; tenant_entitlements exists with RLS enabled + forced; tenant
 * self-read is RLS-isolated; cross-tenant read sees nothing; the operator path reads
 * and grants/revokes; absence and revoked both mean not-entitled; audit-before-change
 * failure blocks the mutation; no secret fields are stored or returned.
 *
 * Runs as the non-superuser platform_app role so RLS actually enforces (operator
 * paths use withSystemAdmin/rls_bypass exactly as production does). Creates its own
 * v4 test organisations and cleans them up. SKIPs honestly (exit 0) if Postgres is
 * unavailable — it never fake-PASSes.
 *
 * Usage: npm run proof:entitlements-postgres   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { withSystemAdmin, withTenant } from "@platform/adapters-postgres";
import type { AuditEvent, AuditEventPort } from "@platform/audit-events";
import { PostgresEntitlementRepository } from "../src/adapters/postgres-entitlement-repository.ts";
import { isEntitled, setEntitlement } from "../src/usecases/entitlements.ts";

loadLocalEnv();

const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");

const SECRET_FIELD = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;
const ACTOR = { actorId: "00000000-0000-0000-0000-000000000000", actorRoles: ["system_operator"] };

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}
function skip(label: string, why: string): void {
  console.log(`SKIP  ${label} — ${why}`);
}

async function reachable(url: string): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 2000, max: 1 });
  try {
    await probe.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
}

async function main(): Promise<void> {
  console.log("# Entitlements LIVE Postgres proof\n");

  if (!(await reachable(APP_URL))) {
    skip(
      "live Postgres proof",
      "platform_app Postgres not reachable (run `make compose-up-default`)"
    );
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const repo = new PostgresEntitlementRepository(app);
  let orgA: string | null = null;
  let orgB: string | null = null;

  try {
    // 1. Migration + schema invariants.
    const reg = await su.query<{ t: string | null }>(
      "SELECT to_regclass('public.tenant_entitlements')::text AS t"
    );
    check(
      "migration 022 ran: tenant_entitlements exists",
      (reg.rows[0]?.t ?? "").includes("tenant_entitlements")
    );

    const rls = await su.query<{ e: boolean; f: boolean }>(
      "SELECT relrowsecurity AS e, relforcerowsecurity AS f FROM pg_class WHERE relname = 'tenant_entitlements'"
    );
    check("RLS is ENABLED on tenant_entitlements", rls.rows[0]?.e === true);
    check("RLS is FORCED on tenant_entitlements", rls.rows[0]?.f === true);

    // 1b. No secret-bearing columns in the schema.
    const cols = await su.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='tenant_entitlements'"
    );
    const secretCols = cols.rows.map((r) => r.column_name).filter((c) => SECRET_FIELD.test(c));
    check(
      "tenant_entitlements has no secret-bearing columns",
      secretCols.length === 0,
      secretCols.join(", ")
    );

    // 2. Two isolated v4 test tenants.
    const a = await su.query<{ id: string }>(
      "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
      ["proof-ent-a-" + Date.now().toString(36), "Proof Entitlements A"]
    );
    orgA = a.rows[0]!.id;
    const b = await su.query<{ id: string }>(
      "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
      ["proof-ent-b-" + Date.now().toString(36), "Proof Entitlements B"]
    );
    orgB = b.rows[0]!.id;
    check("created two isolated v4 test tenants", !!orgA && !!orgB && orgA !== orgB);

    // 3. Absence means not entitled.
    check(
      "absence ⇒ not entitled (orgA/webhooks)",
      !(await isEntitled(orgA, "webhooks", { repository: repo, audit: noopAudit() }))
    );

    // 4. Operator grant (withSystemAdmin path).
    const granted = await repo.upsert({
      organisationId: orgA,
      entitlementKey: "webhooks",
      state: "granted",
      source: "system",
      updatedBy: ACTOR.actorId,
    });
    check("operator can grant (upsert returns granted)", granted.state === "granted");
    check(
      "granted ⇒ entitled",
      await isEntitled(orgA, "webhooks", { repository: repo, audit: noopAudit() })
    );

    // 5. Tenant self-read is RLS-isolated and sees its own grant.
    const selfA = await repo.listForTenant(orgA);
    check(
      "tenant self-read sees its own grant",
      selfA.some((g) => g.entitlementKey === "webhooks" && g.state === "granted")
    );

    // 6. Cross-tenant self-read sees NOTHING (RLS, not just a WHERE clause).
    const selfB = await repo.listForTenant(orgB);
    check("cross-tenant self-read returns no rows for orgB", selfB.length === 0);
    const crossCount = await withTenant(app as never, orgB, async (client) => {
      // No WHERE clause: RLS alone must hide orgA's row from orgB's tenant context.
      const r = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.tenant_entitlements"
      );
      return Number(r.rows[0]?.n ?? "0");
    });
    check("RLS hides orgA's row from orgB's context (unfiltered count = 0)", crossCount === 0);
    const opCount = await withSystemAdmin(app as never, async (client) => {
      const r = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.tenant_entitlements WHERE organisation_id = $1",
        [orgA]
      );
      return Number(r.rows[0]?.n ?? "0");
    });
    check("operator (rls_bypass) CAN read orgA's grant", opCount >= 1);

    // 7. Operator read of a target tenant's grants.
    const opView = await repo.listForTenantAsOperator(orgA);
    check(
      "operator path reads target tenant grants",
      opView.some((g) => g.entitlementKey === "webhooks")
    );

    // 8. Revoke means not entitled.
    await repo.upsert({
      organisationId: orgA,
      entitlementKey: "webhooks",
      state: "revoked",
      source: "system",
      updatedBy: ACTOR.actorId,
    });
    check(
      "revoked ⇒ not entitled",
      !(await isEntitled(orgA, "webhooks", { repository: repo, audit: noopAudit() }))
    );

    // 9. Audit-before-change: a failing audit write must block the mutation (DB unchanged).
    await repo.upsert({
      organisationId: orgA,
      entitlementKey: "storage",
      state: "granted",
      source: "system",
      updatedBy: ACTOR.actorId,
    });
    let threw = false;
    try {
      await setEntitlement(
        { organisationId: orgA, key: "storage", state: "revoked", actor: ACTOR },
        { repository: repo, audit: failingAudit() }
      );
    } catch {
      threw = true;
    }
    const stillGranted = await isEntitled(orgA, "storage", {
      repository: repo,
      audit: noopAudit(),
    });
    check("audit-before-change: mutation rejects when audit fails", threw);
    check("audit-before-change: DB row UNCHANGED after failed audit (still granted)", stillGranted);

    // 10. No secret fields returned in any record.
    const blob = JSON.stringify([...selfA, ...opView]);
    check("returned entitlement records carry no secret fields", !SECRET_FIELD.test(blob));
  } catch (err) {
    check("live entitlements proof", false, err instanceof Error ? err.message : String(err));
  } finally {
    // Cleanup: deleting the orgs cascades to tenant_entitlements.
    if (orgA)
      await su.query("DELETE FROM public.organisations WHERE id = $1", [orgA]).catch(() => {});
    if (orgB)
      await su.query("DELETE FROM public.organisations WHERE id = $1", [orgB]).catch(() => {});
    await app.end().catch(() => {});
    await su.end().catch(() => {});
  }

  console.log(
    failures === 0 ? "\n# ALL CHECKS PASSED (live Postgres)" : `\n# ${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

function noopAudit(): AuditEventPort {
  return { emit: async (_e: AuditEvent) => {}, query: async () => [] };
}
function failingAudit(): AuditEventPort {
  return {
    emit: async (_e: AuditEvent) => {
      throw new Error("audit backend unavailable");
    },
    query: async () => [],
  };
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
