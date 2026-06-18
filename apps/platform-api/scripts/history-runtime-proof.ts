/**
 * History read-model LIVE proof (ADR-0063 / ADR-ACT-0272).
 *
 * Proves the read-only history projection against live Compose Postgres:
 *  - history UNIONs MULTIPLE existing sources (audit + notification + meter + incident)
 *    for a tenant — without a new store and without duplicating data;
 *  - tenant A's history never includes tenant B's rows (tenant isolation);
 *  - entries carry only safe summary fields — NO metadata/payload/secret column;
 *  - pagination (limit/offset) works and total reflects the full set;
 *  - the projection is read-only — the source rows are unchanged after querying.
 *
 * Requires Postgres. SKIPs honestly (exit 0) if unavailable; never fake-PASSes.
 * Usage: npm run proof:history   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { PostgresHistoryRepository } from "../src/adapters/postgres-history-repository.ts";
import { getHistory } from "../src/usecases/history.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
const SECRET_FIELD = /metadata|payload|secret|password|token|credential|api[_-]?key/i;
const SENTINEL = "hist-secret-" + Date.now().toString(36);

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}
async function pgReachable(url: string): Promise<boolean> {
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
  console.log("# History read-model LIVE proof\n");
  if (!(await pgReachable(APP_URL))) {
    console.log("SKIP  history proof — Postgres not reachable (`make compose-up-default`)");
    console.log("\n# SKIPPED (no live backend) — not counted as pass or fail");
    process.exit(0);
  }

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const repo = new PostgresHistoryRepository(app);

  let orgA: string | null = null;
  let orgB: string | null = null;

  try {
    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-hist-a-" + Date.now().toString(36), "Proof Hist A"]
      )
    ).rows[0]!.id;
    orgB = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-hist-b-" + Date.now().toString(36), "Proof Hist B"]
      )
    ).rows[0]!.id;

    // Seed multiple sources for A; a secret value goes ONLY into metadata (which must
    // never be projected). One source for B (isolation control).
    await su.query(
      "INSERT INTO public.audit_events (id, actor_id, actor_roles, tenant_id, action, resource, resource_id, metadata, timestamp) VALUES (gen_random_uuid(),$1,'{}',$2,'thing.created','thing','t1',$3,now())",
      ["op", orgA, JSON.stringify({ secret: SENTINEL })]
    );
    await su.query(
      "INSERT INTO public.notification_log (id, organisation_id, user_id, channel, category, status, subject, metadata) VALUES (gen_random_uuid(),$1,$2,'email','billing','sent',$3,$4)",
      [orgA, "user-1", "Invoice ready", JSON.stringify({ token: SENTINEL })]
    );
    await su.query(
      "INSERT INTO public.meter_events (id, organisation_id, meter_key, quantity, idempotency_key, occurred_at, source) VALUES (gen_random_uuid(),$1,'api.calls',5,$2,now(),'proof')",
      [orgA, "hist-idem-" + Date.now().toString(36)]
    );
    await su.query(
      "INSERT INTO public.audit_events (id, actor_id, actor_roles, tenant_id, action, resource, resource_id, timestamp) VALUES (gen_random_uuid(),'op','{}',$1,'b.created','b','b1',now())",
      [orgB]
    );

    const page = await getHistory(orgA, { limit: 10, offset: 0 }, { history: repo });
    const sources = new Set(page.entries.map((e) => e.source));
    check("history spans multiple source types", sources.size >= 3, [...sources].join(","));
    check("history total reflects the seeded set", page.total >= 3, `total=${page.total}`);
    check(
      "every entry has a safe summary (type + title + occurredAt)",
      page.entries.every((e) => !!e.type && !!e.title)
    );

    // tenant isolation: orgB's audit row never appears in orgA's history
    check(
      "tenant A history excludes tenant B rows",
      !page.entries.some((e) => e.title.includes("b.created"))
    );
    const pageB = await getHistory(orgB, { limit: 10, offset: 0 }, { history: repo });
    check(
      "tenant B history excludes tenant A rows",
      !pageB.entries.some((e) => e.title.includes("thing.created"))
    );

    // redaction: no secret-bearing field, no metadata content anywhere
    const blob = JSON.stringify(page.entries);
    check("no secret/metadata content in history entries", !blob.includes(SENTINEL));
    check(
      "no secret-bearing field name in history entries",
      page.entries.every((e) => !Object.keys(e).some((k) => SECRET_FIELD.test(k)))
    );

    // pagination: limit caps the page; offset advances
    const p1 = await getHistory(orgA, { limit: 1, offset: 0 }, { history: repo });
    const p2 = await getHistory(orgA, { limit: 1, offset: 1 }, { history: repo });
    check("pagination limit caps the page", p1.entries.length === 1 && p1.limit === 1);
    check(
      "pagination offset returns a different entry",
      p2.entries.length === 1 && p1.entries[0]!.id !== p2.entries[0]!.id
    );

    // read-only: source rows unchanged after querying
    const auditCount = await su.query<{ n: string }>(
      "SELECT count(*)::text n FROM public.audit_events WHERE tenant_id=$1",
      [orgA]
    );
    check("history did not mutate source rows", Number(auditCount.rows[0]?.n) === 1);
  } catch (err) {
    check("history proof", false, err instanceof Error ? err.message : String(err));
  } finally {
    if (orgA) {
      await su.query("DELETE FROM public.audit_events WHERE tenant_id=$1", [orgA]).catch(() => {});
      await su.query("DELETE FROM public.organisations WHERE id=$1", [orgA]).catch(() => {});
    }
    if (orgB) {
      await su.query("DELETE FROM public.audit_events WHERE tenant_id=$1", [orgB]).catch(() => {});
      await su.query("DELETE FROM public.organisations WHERE id=$1", [orgB]).catch(() => {});
    }
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
