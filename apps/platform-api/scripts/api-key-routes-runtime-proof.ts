/**
 * API keys + rate limits LIVE route proof (ADR-0065 / ADR-ACT-0257).
 *
 * Exercises the REAL BFF route handlers against live Postgres:
 *   GET    /api/org/api-keys
 *   POST   /api/org/api-keys
 *   DELETE /api/org/api-keys/:keyId
 *   GET    /api/org/developer
 *   GET    /api/org/rate-limits
 *   GET    /api/admin/tenants/:tenantId/api-keys
 *   GET    /api/admin/tenants/:tenantId/rate-limits
 *   PATCH  /api/admin/tenants/:tenantId/rate-limits
 *
 * Proves (handler execution): tenant self-service create returns the secret once
 * and the list never returns it; missing tenant context rejected; revoke works;
 * operator reads work + carry no secret; operator sets a rate-limit policy.
 * Proves (access control, declared metadata enforced by the pipeline): org routes
 * are tenant-scoped + tenant.api_keys.* and tenant.developer.read; operator routes
 * are global + platform.api_keys.read and platform.rate_limits.read / write.
 *
 * The tenant context is resolved from the Host header ({slug}.APEX_DOMAIN).
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 *
 * Usage: npm run proof:api-key-routes   (requires `make compose-up-default`)
 */

import http from "node:http";
import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { routes } from "../src/server/routes.ts";
import type { PipelineRequest, PipelineResponse, Route } from "../src/server/pipeline.ts";
import { PostgresEntitlementRepository } from "../src/adapters/postgres-entitlement-repository.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
const APEX = process.env["APEX_DOMAIN"] ?? "aldous.info";
const SECRET_FIELD = /secret|password|credential|private[_-]?key/i;

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
async function invoke(
  route: Route,
  opts: {
    params?: Record<string, string>;
    body?: unknown;
    host?: string;
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
    raw: { headers: opts.host ? { host: opts.host } : {} } as unknown as http.IncomingMessage,
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

interface ApiKeyRoutes {
  orgList: Route;
  orgCreate: Route;
  orgRevoke: Route;
  orgDev: Route;
  adminKeys: Route;
  adminRlRead: Route;
  adminRlWrite: Route;
}

function checkAccessControlMetadata(): ApiKeyRoutes {
  const orgList = findRoute("GET", "/api/org/api-keys");
  check(
    "org api-keys list is tenant-scoped + tenant.api_keys.read",
    orgList.scope === "tenant" && orgList.requiredPermission === "tenant.api_keys.read"
  );
  const orgCreate = findRoute("POST", "/api/org/api-keys");
  check(
    "org api-keys create is tenant-scoped + tenant.api_keys.write",
    orgCreate.scope === "tenant" && orgCreate.requiredPermission === "tenant.api_keys.write"
  );
  const orgRevoke = findRoute("DELETE", "/api/org/api-keys/:keyId");
  check(
    "org api-keys revoke is tenant-scoped + tenant.api_keys.write",
    orgRevoke.scope === "tenant" && orgRevoke.requiredPermission === "tenant.api_keys.write"
  );
  const orgDev = findRoute("GET", "/api/org/developer");
  check(
    "org developer portal is tenant-scoped + tenant.developer.read",
    orgDev.scope === "tenant" && orgDev.requiredPermission === "tenant.developer.read"
  );
  const adminKeys = findRoute("GET", "/api/admin/tenants/:tenantId/api-keys");
  check(
    "operator api-keys list is global + platform.api_keys.read",
    adminKeys.scope === "global" && adminKeys.requiredPermission === "platform.api_keys.read"
  );
  const adminRlRead = findRoute("GET", "/api/admin/tenants/:tenantId/rate-limits");
  const adminRlWrite = findRoute("PATCH", "/api/admin/tenants/:tenantId/rate-limits");
  check(
    "operator rate-limits read/write are global + platform.rate_limits.*",
    adminRlRead.scope === "global" &&
      adminRlRead.requiredPermission === "platform.rate_limits.read" &&
      adminRlWrite.scope === "global" &&
      adminRlWrite.requiredPermission === "platform.rate_limits.write"
  );
  return { orgList, orgCreate, orgRevoke, orgDev, adminKeys, adminRlRead, adminRlWrite };
}

async function checkOrgSelfService(
  r: ApiKeyRoutes,
  ctx: { host: string; actor: { userId: string; roles: string[] } }
): Promise<{ keyId: string }> {
  const { actor, host } = ctx;

  // org create WITHOUT a tenant context → 400
  check(
    "org create without a tenant context is rejected",
    (await invoke(r.orgCreate, { body: { name: "x" }, actor })).status === 400
  );

  // org create WITH tenant context → 201 + secret once
  const created = await invoke(r.orgCreate, {
    host,
    body: { name: "ci", scopes: ["read"] },
    actor,
  });
  const cbody = created.body as {
    secret?: string;
    secretShownOnce?: boolean;
    apiKey?: { id: string };
  };
  check(
    "tenant self-service create returns 201 with the secret once",
    created.status === 201 && !!cbody.secret?.startsWith("sk_") && cbody.secretShownOnce === true
  );
  const keyId = cbody.apiKey?.id ?? "";
  const secret = cbody.secret ?? "";

  // org list → key present, NO secret
  const listed = await invoke(r.orgList, { host, actor });
  check(
    "org list returns the key without the secret",
    listed.status === 200 &&
      !JSON.stringify(listed.body).includes(secret) &&
      !SECRET_FIELD.test(JSON.stringify(listed.body))
  );

  // developer portal foundation
  const dev = await invoke(r.orgDev, { host, actor });
  const devBody = dev.body as { apiAccessEntitled?: boolean; activeKeyCount?: number };
  check(
    "developer portal reports entitlement + active key count",
    dev.status === 200 && devBody.apiAccessEntitled === true && (devBody.activeKeyCount ?? 0) >= 1
  );
  return { keyId };
}

async function checkOperatorRoutes(
  r: ApiKeyRoutes,
  ctx: { orgA: string; actor: { userId: string; roles: string[] } }
): Promise<void> {
  const { actor, orgA } = ctx;

  // operator list (by tenantId) → key present, no secret
  const opKeys = await invoke(r.adminKeys, { params: { tenantId: orgA }, actor });
  check(
    "operator api-keys read returns the key with no secret",
    opKeys.status === 200 && !SECRET_FIELD.test(JSON.stringify(opKeys.body))
  );
  check(
    "operator api-keys read rejects an invalid tenant id",
    (await invoke(r.adminKeys, { params: { tenantId: "nope" }, actor })).status === 400
  );

  // operator sets a rate-limit policy → 200, then reads it
  const setRl = await invoke(r.adminRlWrite, {
    params: { tenantId: orgA },
    body: {
      policyKey: "api.requests",
      entitlementKey: "api_access",
      limit: 10,
      windowSeconds: 60,
    },
    actor,
  });
  check("operator sets a rate-limit policy via real handler (200)", setRl.status === 200);
  const rlList = await invoke(r.adminRlRead, { params: { tenantId: orgA }, actor });
  const rlBody = rlList.body as { policies?: { policyKey: string }[] };
  check(
    "operator rate-limit read returns the configured policy",
    rlList.status === 200 && !!rlBody.policies?.some((p) => p.policyKey === "api.requests")
  );
}

async function checkOrgRevoke(
  r: ApiKeyRoutes,
  ctx: { host: string; keyId: string; actor: { userId: string; roles: string[] } }
): Promise<void> {
  const { actor, host, keyId } = ctx;

  // revoke via real handler → 200, then invalid id → 400
  check(
    "org revoke succeeds via real handler (200)",
    (await invoke(r.orgRevoke, { host, params: { keyId }, actor })).status === 200
  );
  check(
    "org revoke rejects an invalid key id",
    (await invoke(r.orgRevoke, { host, params: { keyId: "nope" }, actor })).status === 400
  );
}

async function main(): Promise<void> {
  console.log("# API keys + rate limits LIVE route proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  api-key route proof — Postgres not reachable");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }

  // access-control metadata
  const r = checkAccessControlMetadata();

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const actor = { userId: "00000000-0000-0000-0000-000000000000", roles: ["tenant-admin"] };
  let orgA: string | null = null;
  let slug = "";
  try {
    slug = "proof-akr-" + Date.now().toString(36);
    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        [slug, "Proof AKR"]
      )
    ).rows[0]!.id;
    const host = `${slug}.${APEX}`;
    await new PostgresEntitlementRepository(app).upsert({
      organisationId: orgA,
      entitlementKey: "api_access",
      state: "granted",
      source: "system",
      updatedBy: "op",
    });

    const { keyId } = await checkOrgSelfService(r, { host, actor });
    await checkOperatorRoutes(r, { orgA, actor });
    await checkOrgRevoke(r, { host, keyId, actor });
  } catch (err) {
    check("live api-key route proof", false, err instanceof Error ? err.message : String(err));
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
