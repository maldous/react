/**
 * Search tenant-isolation + permission LIVE proof (ADR-0060 / ADR-ACT-0258).
 *
 * Proves, against the local Compose Postgres, the two hard search-safety invariants:
 *  - tenant A's search (run under A's tenant context, RLS-enforced) never returns
 *    tenant B's documents — even for an identical title;
 *  - the permission filter hides rows whose permission_key the caller does not hold.
 *
 * Runs repos as platform_app (RLS enforces). Creates + cleans up its own orgs.
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 *
 * Usage: npm run proof:search-isolation   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv } from "./lib/local-env.ts";
import type { AuditEventPort } from "@platform/audit-events";
import { PostgresSearchRepository } from "../src/adapters/postgres-search-repository.ts";
import { indexDocument, searchProducts } from "../src/usecases/search.ts";

loadLocalEnv();
const SU_URL =
  process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";
const APP_URL =
  process.env["POSTGRES_APP_URL"] ??
  "postgresql://platform_app:platformapppassword@localhost:5433/platform";
const noopAudit: AuditEventPort = { emit: async () => {}, query: async () => [] };

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
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
  console.log("# Search isolation + permission LIVE proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  search-isolation proof — Postgres not reachable");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const repo = new PostgresSearchRepository(app);
  const deps = { index: repo, query: repo, audit: noopAudit };
  let orgA: string | null = null;
  let orgB: string | null = null;

  try {
    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-si-a-" + Date.now().toString(36), "Proof SI A"]
      )
    ).rows[0]!.id;
    orgB = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-si-b-" + Date.now().toString(36), "Proof SI B"]
      )
    ).rows[0]!.id;

    // Both tenants index a document with the SAME title.
    await indexDocument(
      {
        organisationId: orgA,
        documentId: "d1",
        documentType: "product",
        title: "shared title alpha",
        body: "tenant a content",
      },
      deps
    );
    await indexDocument(
      {
        organisationId: orgB,
        documentId: "d1",
        documentType: "product",
        title: "shared title alpha",
        body: "tenant b content",
      },
      deps
    );

    const aResults = await searchProducts(orgA, { q: "alpha" }, [], deps);
    check(
      "tenant A search returns exactly its own one document",
      aResults.total === 1,
      `total=${aResults.total}`
    );
    const bResults = await searchProducts(orgB, { q: "alpha" }, [], deps);
    check(
      "tenant B search returns exactly its own one document",
      bResults.total === 1,
      `total=${bResults.total}`
    );
    check(
      "RLS prevents A's query from seeing B's document (and vice versa)",
      aResults.total === 1 && bResults.total === 1
    );

    // Permission filter: A indexes a restricted doc.
    await indexDocument(
      {
        organisationId: orgA,
        documentId: "r1",
        documentType: "doc",
        title: "alpha restricted memo",
        body: "confidential",
        permissionKey: "docs.restricted.read",
      },
      deps
    );
    const noPerm = await searchProducts(orgA, { q: "restricted" }, [], deps);
    check(
      "permission filter hides a restricted doc from a caller without the permission",
      noPerm.total === 0
    );
    const withPerm = await searchProducts(
      orgA,
      { q: "restricted" },
      ["docs.restricted.read"],
      deps
    );
    check(
      "permission filter reveals the restricted doc to a holder of the permission",
      withPerm.total === 1
    );
  } catch (err) {
    check("live search-isolation proof", false, err instanceof Error ? err.message : String(err));
  } finally {
    if (orgA)
      await su.query("DELETE FROM public.organisations WHERE id=$1", [orgA]).catch(() => {});
    if (orgB)
      await su.query("DELETE FROM public.organisations WHERE id=$1", [orgB]).catch(() => {});
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
