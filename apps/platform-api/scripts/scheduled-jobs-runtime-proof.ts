/**
 * Scheduled jobs LIVE Postgres proof (ADR-0059 / ADR-ACT-0262).
 *
 * Proves against live Postgres: a schedule persists; a DUE job enqueues an event onto
 * the Phase-5 outbox (tenant id preserved); a PAUSED job does not enqueue; idempotency
 * prevents a duplicate enqueue in the same due window; run-now enqueues; RLS isolates
 * jobs per tenant; no secret-bearing columns.
 *
 * Runs repos as platform_app (RLS enforces). Creates + cleans up its own orgs.
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 *
 * Usage: npm run proof:scheduled-jobs   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv } from "./lib/local-env.ts";
import { withTenant } from "@platform/adapters-postgres";
import type { AuditEventPort } from "@platform/audit-events";
import { PostgresScheduledJobRepository } from "../src/adapters/postgres-scheduled-job-repository.ts";
import { PostgresEventBus } from "../src/adapters/postgres-event-bus.ts";
import {
  listScheduledJobs,
  runDueJobs,
  runScheduledJobNow,
  setScheduledJob,
  setScheduledJobEnabled,
} from "../src/usecases/scheduled-jobs.ts";

loadLocalEnv();
const SU_URL =
  process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";
const APP_URL =
  process.env["POSTGRES_APP_URL"] ??
  "postgresql://platform_app:platformapppassword@localhost:5433/platform";
const SECRET_FIELD = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;
const noopAudit: AuditEventPort = { emit: async () => {}, query: async () => [] };
const ACTOR = { actorId: "00000000-0000-0000-0000-000000000000", actorRoles: ["system-admin"] };

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
async function eventCount(su: pg.Pool, org: string, type: string): Promise<number> {
  const r = await su.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM public.platform_events WHERE organisation_id=$1 AND event_type=$2",
    [org, type]
  );
  return Number(r.rows[0]?.n ?? "0");
}

async function main(): Promise<void> {
  console.log("# Scheduled jobs LIVE Postgres proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  scheduled-jobs proof — Postgres not reachable");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }
  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const jobs = new PostgresScheduledJobRepository(app);
  const deps = { jobs, bus: new PostgresEventBus(app), audit: noopAudit };
  let orgA: string | null = null;
  let orgB: string | null = null;
  try {
    const cols = await su.query<{ c: string }>(
      "SELECT column_name AS c FROM information_schema.columns WHERE table_schema='public' AND table_name='scheduled_jobs'"
    );
    check(
      "scheduled_jobs has no secret-bearing columns",
      !cols.rows.some((r) => SECRET_FIELD.test(r.c))
    );

    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-sched-a-" + Date.now().toString(36), "Proof Sched A"]
      )
    ).rows[0]!.id;
    orgB = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-sched-b-" + Date.now().toString(36), "Proof Sched B"]
      )
    ).rows[0]!.id;

    const evt = "report.run." + Date.now().toString(36);
    await setScheduledJob(
      {
        organisationId: orgA,
        jobKey: "nightly",
        eventType: evt,
        intervalSeconds: 3600,
        actor: ACTOR,
      },
      deps
    );
    check(
      "schedule persists",
      (await listScheduledJobs(orgA, deps, { operator: true })).jobs.some(
        (j) => j.jobKey === "nightly"
      )
    );

    const jobId = (await jobs.findById(
      (await listScheduledJobs(orgA, deps, { operator: true })).jobs[0]!.id
    ))!.id;
    // backdate to a FIXED past time so the job is due and the window bucket is stable
    const fixed = "2020-01-01T00:00:00.000Z";
    await su.query("UPDATE public.scheduled_jobs SET next_run_at=$2 WHERE id=$1", [jobId, fixed]);

    const first = await runDueJobs(deps);
    check("due job enqueues an event", first.enqueued === 1, `enqueued=${first.enqueued}`);
    check("tenant id preserved on the enqueued event", (await eventCount(su, orgA, evt)) === 1);

    // same-window re-tick: reset next_run_at to the SAME fixed time → same idempotency key
    await su.query("UPDATE public.scheduled_jobs SET next_run_at=$2 WHERE id=$1", [jobId, fixed]);
    const second = await runDueJobs(deps);
    check(
      "same-window re-tick is deduplicated (no double enqueue)",
      second.enqueued === 0 && second.deduplicated === 1
    );
    check("still exactly one event for the window", (await eventCount(su, orgA, evt)) === 1);

    // pause → not due
    await setScheduledJobEnabled({ jobId, enabled: false, actor: ACTOR }, deps);
    await su.query("UPDATE public.scheduled_jobs SET next_run_at=$2 WHERE id=$1", [jobId, fixed]);
    const paused = await runDueJobs(deps);
    check("paused job does not enqueue", paused.due === 0);

    // run-now (explicit) → enqueues a fresh event
    const beforeNow = await eventCount(su, orgA, evt);
    const now = await runScheduledJobNow({ jobId, actor: ACTOR }, deps);
    check(
      "run-now enqueues an event",
      now.kind === "ok" &&
        now.response.enqueued &&
        (await eventCount(su, orgA, evt)) === beforeNow + 1
    );

    // RLS isolation
    const cross = await withTenant(app as never, orgB!, async (client) => {
      const r = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.scheduled_jobs WHERE organisation_id=$1",
        [orgA]
      );
      return Number(r.rows[0]?.n ?? "0");
    });
    check("RLS hides orgA's scheduled jobs from orgB's tenant context (count = 0)", cross === 0);
  } catch (err) {
    check("live scheduled-jobs proof", false, err instanceof Error ? err.message : String(err));
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
