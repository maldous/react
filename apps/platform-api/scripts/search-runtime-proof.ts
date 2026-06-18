/**
 * Search LIVE Postgres proof (ADR-0060 / ADR-ACT-0258).
 *
 * Proves the built-in Postgres full-text search substrate against the local Compose
 * Postgres: index + query; secret-bearing metadata rejected before indexing; removed
 * document disappears; reindex rebuilds the tsvector; empty query rejected; no
 * secret-bearing columns; results carry no body/secret fields.
 *
 * Runs repos as platform_app (RLS enforces). Creates + cleans up its own org.
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 *
 * Usage: npm run proof:search   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import type { AuditEventPort } from "@platform/audit-events";
import { PostgresSearchRepository } from "../src/adapters/postgres-search-repository.ts";
import {
  getSearchReadiness,
  indexDocument,
  removeDocument,
  reindexTenant,
  searchProducts,
} from "../src/usecases/search.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
const SECRET_FIELD = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;
const noopAudit: AuditEventPort = { emit: async () => {}, query: async () => [] };

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
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
  console.log("# Search LIVE Postgres proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  search proof — Postgres not reachable (run `make compose-up-default`)");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const repo = new PostgresSearchRepository(app);
  const deps = { index: repo, query: repo, audit: noopAudit };
  let orgA: string | null = null;

  try {
    const cols = await su.query<{ c: string }>(
      "SELECT column_name AS c FROM information_schema.columns WHERE table_schema='public' AND table_name='search_documents'"
    );
    check(
      "search_documents has no secret-bearing columns",
      !cols.rows.some((r) => SECRET_FIELD.test(r.c)),
      cols.rows.map((r) => r.c).join(",")
    );

    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-search-a-" + Date.now().toString(36), "Proof Search A"]
      )
    ).rows[0]!.id;

    // empty query rejected
    let emptyThrew = false;
    try {
      await searchProducts(orgA, { q: "   " }, [], deps);
    } catch {
      emptyThrew = true;
    }
    check("empty query rejected safely", emptyThrew);

    // secret-bearing metadata rejected
    let secretThrew = false;
    try {
      await indexDocument(
        {
          organisationId: orgA,
          documentId: "bad",
          documentType: "product",
          title: "x",
          body: "y",
          metadata: { password: "leak" },
        },
        deps
      );
    } catch {
      secretThrew = true;
    }
    check("secret-bearing metadata rejected before indexing", secretThrew);

    // index two docs, search
    await indexDocument(
      {
        organisationId: orgA,
        documentId: "p1",
        documentType: "product",
        title: "Blue widget",
        body: "a sturdy blue widget for industry",
        url: "/products/p1",
      },
      deps
    );
    await indexDocument(
      {
        organisationId: orgA,
        documentId: "p2",
        documentType: "product",
        title: "Red gadget",
        body: "a shiny red gadget",
      },
      deps
    );
    const res = await searchProducts(orgA, { q: "widget" }, [], deps);
    check(
      "full-text search returns the matching document",
      res.total === 1 && res.hits[0]?.documentId === "p1",
      `total=${res.total}`
    );
    check(
      "results carry no body or secret fields",
      !SECRET_FIELD.test(JSON.stringify(res)) && !JSON.stringify(res).includes("sturdy")
    );

    // reindex returns count
    const re = await reindexTenant(
      { organisationId: orgA, actor: { actorId: "op", actorRoles: ["system-admin"] } },
      deps
    );
    check(
      "reindex rebuilds the tsvector and reports the count",
      re.reindexed === 2,
      `reindexed=${re.reindexed}`
    );

    // removed document disappears
    check("remove deletes the document", await removeDocument(orgA, "product", "p1", deps));
    const after = await searchProducts(orgA, { q: "widget" }, [], deps);
    check("removed document no longer appears in search", after.total === 0);

    // readiness reachable
    const readiness = await getSearchReadiness(deps);
    check(
      "readiness reports postgres-fts reachable (ready/degraded, not blocked)",
      readiness.status !== "blocked",
      readiness.status
    );
  } catch (err) {
    check("live search proof", false, err instanceof Error ? err.message : String(err));
  } finally {
    if (orgA)
      await su.query("DELETE FROM public.organisations WHERE id=$1", [orgA]).catch(() => {});
    await app.end().catch(() => {});
    await su.end().catch(() => {});
  }

  console.log(
    failures === 0 ? "\n# ALL CHECKS PASSED (live Postgres)" : `\n# ${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
