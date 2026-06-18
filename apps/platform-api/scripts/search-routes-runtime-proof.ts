/**
 * Search LIVE route proof (ADR-0060 / ADR-ACT-0258).
 *
 * Exercises the REAL BFF route handlers against live Postgres:
 *   POST /api/org/search
 *   GET  /api/admin/search/readiness
 *   POST /api/admin/search/reindex
 *
 * Proves (handler execution): tenant search returns indexed results; missing tenant
 * context rejected; empty query rejected; operator readiness reports a non-blocked
 * status; operator reindex returns a count; results carry no secret fields. Proves
 * (access control): org search is tenant-scoped + tenant.search.read; readiness/reindex
 * are global + platform.search.read / platform.search.write.
 *
 * Tenant context resolved from the Host header ({slug}.APEX_DOMAIN). Documents are
 * seeded via the server-internal index port (indexing is not an HTTP route).
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 *
 * Usage: npm run proof:search-routes   (requires `make compose-up-default`)
 */

import http from "node:http";
import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { routes } from "../src/server/routes.ts";
import type { PipelineRequest, PipelineResponse, Route } from "../src/server/pipeline.ts";
import { PostgresSearchRepository } from "../src/adapters/postgres-search-repository.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
const APEX = process.env["APEX_DOMAIN"] ?? "aldous.info";
const SECRET_FIELD = /secret|password|credential|private[_-]?key/i;

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
    host?: string;
    actor?: { userId: string; roles: string[]; permissions: string[] };
  }
): Promise<{ status: number; body: unknown }> {
  const captured = { status: 0, body: null as unknown };
  const req = {
    method: route.method,
    path: route.path,
    params: opts.params ?? {},
    requestId: "proof",
    body: opts.body ?? undefined,
    actor: opts.actor ? (opts.actor as never) : null,
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

async function main(): Promise<void> {
  console.log("# Search LIVE route proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  search route proof — Postgres not reachable");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }

  const orgSearch = findRoute("POST", "/api/org/search");
  check(
    "org search is tenant-scoped + tenant.search.read",
    orgSearch.scope === "tenant" && orgSearch.requiredPermission === "tenant.search.read"
  );
  const readiness = findRoute("GET", "/api/admin/search/readiness");
  check(
    "search readiness is global + platform.search.read",
    readiness.scope === "global" && readiness.requiredPermission === "platform.search.read"
  );
  const reindex = findRoute("POST", "/api/admin/search/reindex");
  check(
    "search reindex is global + platform.search.write",
    reindex.scope === "global" && reindex.requiredPermission === "platform.search.write"
  );

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const repo = new PostgresSearchRepository(app);
  const actor = {
    userId: "00000000-0000-0000-0000-000000000000",
    roles: ["tenant-admin"],
    permissions: ["tenant.search.read"],
  };
  const opActor = {
    userId: "00000000-0000-0000-0000-000000000000",
    roles: ["system-admin"],
    permissions: ["platform.search.read", "platform.search.write"],
  };
  let orgA: string | null = null;
  let slug = "";
  try {
    slug = "proof-srr-" + Date.now().toString(36);
    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        [slug, "Proof SRR"]
      )
    ).rows[0]!.id;
    const host = `${slug}.${APEX}`;
    // seed a document via the server-internal index port
    await repo.index({
      organisationId: orgA,
      documentId: "p1",
      documentType: "product",
      title: "Routing widget",
      body: "a widget reachable from the route proof",
      url: "/products/p1",
    });

    // org search without a tenant context → 400
    check(
      "org search without a tenant context is rejected",
      (await invoke(orgSearch, { body: { q: "widget" }, actor })).status === 400
    );
    // org search with tenant context → 200 + the hit, no secrets
    const r = await invoke(orgSearch, { host, body: { q: "widget" }, actor });
    const body = r.body as { hits?: { documentId: string }[]; total?: number };
    check(
      "tenant search returns the indexed document via the real handler",
      r.status === 200 && body.total === 1 && body.hits?.[0]?.documentId === "p1"
    );
    check("search response carries no secret fields", !SECRET_FIELD.test(JSON.stringify(r.body)));
    // empty query → 400
    check(
      "org search rejects an empty query",
      (await invoke(orgSearch, { host, body: { q: "" }, actor })).status === 400
    );

    // operator readiness → 200, not blocked
    const rd = await invoke(readiness, { actor: opActor });
    const rdBody = rd.body as { status?: string; engine?: string };
    check(
      "operator readiness returns a non-blocked postgres-fts status",
      rd.status === 200 && rdBody.engine === "postgres-fts" && rdBody.status !== "blocked"
    );

    // operator reindex → 200 with a count
    const ri = await invoke(reindex, { body: { tenantId: orgA }, actor: opActor });
    const riBody = ri.body as { reindexed?: number };
    check(
      "operator reindex returns a count via the real handler",
      ri.status === 200 && (riBody.reindexed ?? -1) >= 1
    );
    check(
      "reindex rejects an invalid tenant id",
      (await invoke(reindex, { body: { tenantId: "nope" }, actor: opActor })).status === 400
    );
  } catch (err) {
    check("live search route proof", false, err instanceof Error ? err.message : String(err));
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
