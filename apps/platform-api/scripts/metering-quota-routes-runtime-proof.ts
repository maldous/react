/**
 * Metering + quota LIVE route proof (ADR-0067 / ADR-ACT-0256).
 *
 * Exercises the REAL BFF route handlers against live Postgres:
 *   POST  /api/admin/tenants/:tenantId/meter-events
 *   GET   /api/org/usage
 *   GET   /api/admin/tenants/:tenantId/usage
 *   GET   /api/org/quotas
 *   GET   /api/admin/tenants/:tenantId/quotas
 *   PATCH /api/admin/tenants/:tenantId/quotas
 *
 * Proves (handler execution): operator ingestion records + dedups; invalid tenant id
 * rejected; org reads need a tenant context; operator usage/quota reads work; operator
 * sets a quota; responses carry no secret fields. Proves (access control, declared
 * metadata enforced by the pipeline): ingestion is operator/global + platform.metering.write
 * (tenant self-ingestion not exposed); reads are tenant.metering.read / platform.*.read.
 *
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 *
 * Usage: npm run proof:metering-quota-routes   (requires `make compose-up-default`)
 */

import http from "node:http";
import pg from "pg";
import { loadLocalEnv } from "./lib/local-env.ts";
import { routes } from "../src/server/routes.ts";
import type { PipelineRequest, PipelineResponse, Route } from "../src/server/pipeline.ts";
import { PostgresEntitlementRepository } from "../src/adapters/postgres-entitlement-repository.ts";

loadLocalEnv();
const SU_URL =
  process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";
const APP_URL =
  process.env["POSTGRES_APP_URL"] ??
  "postgresql://platform_app:platformapppassword@localhost:5433/platform";
const SECRET_FIELD = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
function findRoute(method: string, path: string): Route {
  const r = routes.find((x) => x.method === method && x.path === path);
  if (!r) throw new Error(`route not found: ${method} ${path}`);
  return r;
}
async function invoke(
  route: Route,
  opts: {
    params?: Record<string, string>;
    body?: unknown;
    actor?: { userId: string; roles: string[] };
  }
): Promise<{ status: number; body: unknown }> {
  const captured = { status: 0, body: null as unknown };
  const req = {
    method: route.method,
    path: route.path,
    params: opts.params ?? {},
    requestId: "proof",
    body: opts.body ?? undefined,
    actor: opts.actor ? ({ userId: opts.actor.userId, roles: opts.actor.roles } as never) : null,
    context: {} as never,
    raw: { headers: {} } as unknown as http.IncomingMessage,
  } as unknown as PipelineRequest;
  const res = {
    raw: {} as unknown as http.ServerResponse,
    json: (status: number, body: unknown) => {
      captured.status = status;
      captured.body = body;
    },
  } as PipelineResponse;
  await route.handler(req, res);
  return captured;
}
async function reachable(url: string): Promise<boolean> {
  const p = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 2000, max: 1 });
  try {
    await p.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await p.end().catch(() => {});
  }
}

async function main(): Promise<void> {
  console.log("# Metering + quota LIVE route proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  metering/quota route proof — Postgres not reachable");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }

  // access-control metadata
  const ingest = findRoute("POST", "/api/admin/tenants/:tenantId/meter-events");
  check("ingestion is operator/global-scoped", ingest.scope === "global");
  check(
    "ingestion requires platform.metering.write (tenant self-ingestion not exposed)",
    ingest.requiredPermission === "platform.metering.write"
  );
  const orgUsage = findRoute("GET", "/api/org/usage");
  check(
    "org usage is tenant-scoped + tenant.metering.read",
    orgUsage.scope === "tenant" && orgUsage.requiredPermission === "tenant.metering.read"
  );
  const adminUsage = findRoute("GET", "/api/admin/tenants/:tenantId/usage");
  check(
    "operator usage is global + platform.metering.read",
    adminUsage.scope === "global" && adminUsage.requiredPermission === "platform.metering.read"
  );
  const orgQuotas = findRoute("GET", "/api/org/quotas");
  check(
    "org quotas is tenant-scoped + tenant.metering.read",
    orgQuotas.scope === "tenant" && orgQuotas.requiredPermission === "tenant.metering.read"
  );
  const adminQuotasRead = findRoute("GET", "/api/admin/tenants/:tenantId/quotas");
  check(
    "operator quotas read is global + platform.quotas.read",
    adminQuotasRead.scope === "global" &&
      adminQuotasRead.requiredPermission === "platform.quotas.read"
  );
  const adminQuotasWrite = findRoute("PATCH", "/api/admin/tenants/:tenantId/quotas");
  check(
    "operator quotas write is global + platform.quotas.write",
    adminQuotasWrite.scope === "global" &&
      adminQuotasWrite.requiredPermission === "platform.quotas.write"
  );

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  let orgA: string | null = null;
  const actor = { userId: "00000000-0000-0000-0000-000000000000", roles: ["system-admin"] };
  try {
    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-mqr-" + Date.now().toString(36), "Proof MQ Routes"]
      )
    ).rows[0]!.id;
    await new PostgresEntitlementRepository(app).upsert({
      organisationId: orgA,
      entitlementKey: "webhooks",
      state: "granted",
      source: "system",
      updatedBy: "op",
    });

    // ingestion: invalid tenant id → 400
    check(
      "ingestion rejects invalid tenant id",
      (
        await invoke(ingest, {
          params: { tenantId: "nope" },
          body: { meterKey: "webhooks.deliveries", quantity: 1, idempotencyKey: "x" },
          actor,
        })
      ).status === 400
    );
    // ingestion: record → 201, replay → 200
    const rec = await invoke(ingest, {
      params: { tenantId: orgA },
      body: { meterKey: "webhooks.deliveries", quantity: 1, idempotencyKey: "route1" },
      actor,
    });
    check("ingestion records a meter event (201)", rec.status === 201);
    const dup = await invoke(ingest, {
      params: { tenantId: orgA },
      body: { meterKey: "webhooks.deliveries", quantity: 1, idempotencyKey: "route1" },
      actor,
    });
    check("ingestion replay is idempotent (200 deduplicated)", dup.status === 200);

    // org usage without a tenant context → 400
    check(
      "org usage without a tenant context is rejected",
      (await invoke(orgUsage, {})).status === 400
    );

    // operator usage → 200, shows webhooks.deliveries, no secrets
    const usage = await invoke(adminUsage, { params: { tenantId: orgA }, actor });
    const usageBody = usage.body as { usage?: { meterKey: string; usage: number }[] };
    check(
      "operator usage handler returns 200 with the meter",
      usage.status === 200 && !!usageBody.usage?.some((u) => u.meterKey === "webhooks.deliveries")
    );
    check(
      "usage response carries no secret fields",
      !SECRET_FIELD.test(JSON.stringify(usage.body))
    );

    // operator sets a quota → 200
    const setQ = await invoke(adminQuotasWrite, {
      params: { tenantId: orgA },
      body: {
        quotaKey: "webhooks.deliveries",
        entitlementKey: "webhooks",
        meterKey: "webhooks.deliveries",
        limit: 5,
        window: "lifetime",
        action: "deny",
      },
      actor,
    });
    check("operator sets a quota via real handler (200)", setQ.status === 200);

    // operator reads quotas → 200, shows the quota, no secrets
    const quotas = await invoke(adminQuotasRead, { params: { tenantId: orgA }, actor });
    const quotaBody = quotas.body as { quotas?: { quotaKey: string }[] };
    check(
      "operator quota read returns the configured quota",
      quotas.status === 200 && !!quotaBody.quotas?.some((q) => q.quotaKey === "webhooks.deliveries")
    );
    check(
      "quota response carries no secret fields",
      !SECRET_FIELD.test(JSON.stringify(quotas.body))
    );
  } catch (err) {
    check(
      "live metering/quota route proof",
      false,
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    if (orgA)
      await su.query("DELETE FROM public.organisations WHERE id=$1", [orgA]).catch(() => {});
    await app.end().catch(() => {});
    await su.end().catch(() => {});
  }

  console.log(
    failures === 0 ? "\n# ALL CHECKS PASSED (live routes)" : `\n# ${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
