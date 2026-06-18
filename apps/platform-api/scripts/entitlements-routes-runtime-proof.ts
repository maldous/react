/**
 * Entitlements LIVE route proof (ADR-0055 / ADR-0058 / ADR-ACT-0255).
 *
 * Exercises the REAL BFF route handlers from server/routes.ts against live Postgres:
 *   GET  /api/org/entitlements
 *   GET  /api/admin/tenants/:tenantId/entitlements
 *   PATCH /api/admin/tenants/:tenantId/entitlements
 *   GET  /api/platform/service-catalog
 *
 * Proves (handler execution): org read requires a tenant context; invalid tenant id
 * is rejected; unknown entitlement key is rejected; operator grant/revoke + read work;
 * the service catalog returns no secrets and the operator/global view. Proves (access
 * control, declared metadata enforced by the pipeline — see api-pipeline substrate
 * tests): org route is tenant-scoped; admin routes are global-scoped + require
 * platform.entitlements.read/write (so a tenant-admin can neither reach the PATCH route
 * nor self-grant).
 *
 * SKIPs honestly (exit 0) if Postgres is unavailable.
 *
 * Usage: npm run proof:entitlements-routes   (requires `make compose-up-default`)
 */

import http from "node:http";
import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { routes } from "../src/server/routes.ts";
import type { PipelineRequest, PipelineResponse, Route } from "../src/server/pipeline.ts";

loadLocalEnv();

const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");

const SECRET_FIELD = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}

function findRoute(method: string, path: string): Route {
  const r = routes.find((x) => x.method === method && x.path === path);
  if (!r) throw new Error(`route not found: ${method} ${path}`);
  return r;
}

interface Captured {
  status: number;
  body: unknown;
}

async function invoke(
  route: Route,
  opts: {
    params?: Record<string, string>;
    body?: unknown;
    actor?: { userId: string; roles: string[] };
  }
): Promise<Captured> {
  const captured: Captured = { status: 0, body: null };
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
  console.log("# Entitlements LIVE route proof\n");

  if (!(await reachable(APP_URL))) {
    console.log("SKIP  live route proof — Postgres not reachable (run `make compose-up-default`)");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }

  // --- access-control metadata (the pipeline enforces these; see api-pipeline tests) ---
  const orgRead = findRoute("GET", "/api/org/entitlements");
  check("org read route is tenant-scoped", orgRead.scope === "tenant");
  check(
    "org read route requires tenant.entitlements.read",
    orgRead.requiredPermission === "tenant.entitlements.read"
  );

  const adminRead = findRoute("GET", "/api/admin/tenants/:tenantId/entitlements");
  check("operator read route is global-scoped", adminRead.scope === "global");
  check(
    "operator read route requires platform.entitlements.read",
    adminRead.requiredPermission === "platform.entitlements.read"
  );

  const adminWrite = findRoute("PATCH", "/api/admin/tenants/:tenantId/entitlements");
  check(
    "operator write route is global-scoped (tenant FQDN cannot reach it)",
    adminWrite.scope === "global"
  );
  check(
    "operator write route requires platform.entitlements.write (tenant-admin cannot self-grant)",
    adminWrite.requiredPermission === "platform.entitlements.write"
  );

  const catalog = findRoute("GET", "/api/platform/service-catalog");
  check("service-catalog route is operator/global-scoped", catalog.scope === "global");

  const su = new pg.Pool({ connectionString: SU_URL });
  let orgA: string | null = null;
  try {
    const a = await su.query<{ id: string }>(
      "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
      ["proof-ent-routes-" + Date.now().toString(36), "Proof Entitlements Routes"]
    );
    orgA = a.rows[0]!.id;
    const actor = { userId: "00000000-0000-0000-0000-000000000000", roles: ["system-admin"] };

    // --- real handler execution ---
    // org read with no tenant context (empty headers) → handler returns 400 NO_TENANT.
    const orgNoTenant = await invoke(orgRead, {});
    check(
      "org read without a tenant context is rejected (handler 400)",
      orgNoTenant.status === 400
    );

    // invalid tenant id → 400.
    const invalid = await invoke(adminWrite, {
      params: { tenantId: "not-a-uuid" },
      body: { key: "webhooks", state: "granted" },
      actor,
    });
    check("operator write rejects an invalid tenant id (400)", invalid.status === 400);

    // unknown entitlement key → rejected (schema 400).
    const unknown = await invoke(adminWrite, {
      params: { tenantId: orgA },
      body: { key: "totally_made_up", state: "granted" },
      actor,
    });
    check("operator write rejects an unknown entitlement key", unknown.status === 400);

    // grant → 200.
    const grant = await invoke(adminWrite, {
      params: { tenantId: orgA },
      body: { key: "webhooks", state: "granted" },
      actor,
    });
    check("operator grant via real handler returns 200", grant.status === 200);

    // operator read → shows the grant.
    const opList = await invoke(adminRead, { params: { tenantId: orgA }, actor });
    const listBody = opList.body as { entitlements?: { key: string; state: string }[] };
    check(
      "operator read via real handler shows the granted entitlement",
      opList.status === 200 &&
        !!listBody.entitlements?.some((e) => e.key === "webhooks" && e.state === "granted")
    );

    // revoke → 200.
    const revoke = await invoke(adminWrite, {
      params: { tenantId: orgA },
      body: { key: "webhooks", state: "revoked" },
      actor,
    });
    check("operator revoke via real handler returns 200", revoke.status === 200);

    // service catalog → 200, operator/global view, no secrets.
    const cat = await invoke(catalog, { actor });
    const catBody = cat.body as { services?: Record<string, unknown>[] };
    check("service-catalog handler returns 200", cat.status === 200);
    check(
      "service-catalog returns the operator/global view (includes non-tenant-safe entries)",
      !!catBody.services?.some((s) => s["visibility"] !== "tenant_scoped_safe")
    );
    // Check field NAMES (prose like "secretsmanager" in isolationNotes is allowed; keys are not).
    const secretKeys = (catBody.services ?? []).flatMap((s) =>
      Object.keys(s).filter((k) => SECRET_FIELD.test(k))
    );
    check(
      "service-catalog entries carry no secret-bearing fields",
      secretKeys.length === 0,
      secretKeys.join(", ")
    );
  } catch (err) {
    check("live route proof", false, err instanceof Error ? err.message : String(err));
  } finally {
    if (orgA)
      await su.query("DELETE FROM public.organisations WHERE id = $1", [orgA]).catch(() => {});
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
