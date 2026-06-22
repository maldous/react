/**
 * Scheduled-job LIVE route proof (ADR-0059 / ADR-ACT-0262).
 *
 * Exercises the REAL BFF route handlers against live Postgres:
 *   GET   /api/admin/scheduled-jobs
 *   POST  /api/admin/scheduled-jobs
 *   POST  /api/admin/scheduled-jobs/:jobId/run
 *   PATCH /api/admin/scheduled-jobs/:jobId
 *
 * Proves: operator creates a schedule; lists it; run-now enqueues; pause toggles
 * enabled; missing organisationId rejected; invalid ids rejected; access-control
 * metadata (global + platform.jobs.read/write).
 *
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 * Usage: npm run proof:scheduled-job-routes   (requires `make compose-up-default`)
 */

import http from "node:http";
import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { PostgresEventBus, PostgresWorkerRegistry } from "../src/adapters/postgres-event-bus.ts";
import type { ClaimedEvent } from "../src/ports/event-bus.ts";
import { routes } from "../src/server/routes.ts";
import type { PipelineRequest, PipelineResponse, Route } from "../src/server/pipeline.ts";
import { processNext } from "../src/usecases/events.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
const OP = {
  userId: "00000000-0000-0000-0000-000000000000",
  roles: ["system-admin"],
  permissions: ["platform.jobs.read", "platform.jobs.write"],
};

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
  opts: { params?: Record<string, string>; body?: unknown; url?: string }
): Promise<{ status: number; body: unknown }> {
  const captured = { status: 0, body: null as unknown };
  const req = {
    method: route.method,
    path: route.path,
    params: opts.params ?? {},
    requestId: "proof",
    body: opts.body ?? undefined,
    actor: OP as never,
    context: {} as never,
    raw: { headers: {}, url: opts.url ?? route.path } as unknown as http.IncomingMessage,
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
  console.log("# Scheduled-job LIVE route proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  scheduled-job route proof — Postgres not reachable");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }
  const listR = findRoute("GET", "/api/admin/scheduled-jobs");
  const createR = findRoute("POST", "/api/admin/scheduled-jobs");
  const runR = findRoute("POST", "/api/admin/scheduled-jobs/:jobId/run");
  const patchR = findRoute("PATCH", "/api/admin/scheduled-jobs/:jobId");
  check(
    "scheduled-job routes are global + platform.jobs.read/write",
    listR.scope === "global" &&
      listR.requiredPermission === "platform.jobs.read" &&
      createR.requiredPermission === "platform.jobs.write" &&
      runR.requiredPermission === "platform.jobs.write" &&
      patchR.requiredPermission === "platform.jobs.write"
  );

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const workerId = "proof-sjr-worker-" + Date.now().toString(36);
  let orgA: string | null = null;
  try {
    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-sjr-" + Date.now().toString(36), "Proof SJR"]
      )
    ).rows[0]!.id;

    check(
      "list requires organisationId",
      (await invoke(listR, { url: "/api/admin/scheduled-jobs" })).status === 400
    );

    const created = await invoke(createR, {
      body: {
        organisationId: orgA,
        jobKey: "nightly",
        eventType: "report.run",
        intervalSeconds: 3600,
      },
    });
    check("operator creates a schedule via the real handler (200)", created.status === 200);

    const list = await invoke(listR, { url: `/api/admin/scheduled-jobs?organisationId=${orgA}` });
    const body = list.body as { jobs?: { id: string; jobKey: string }[] };
    check(
      "list returns the created job",
      list.status === 200 && !!body.jobs?.some((j) => j.jobKey === "nightly")
    );
    const jobId = body.jobs!.find((j) => j.jobKey === "nightly")!.id;

    const run = await invoke(runR, { params: { jobId } });
    const runBody = run.body as { enqueued?: boolean };
    check(
      "run-now enqueues via the real handler (200)",
      run.status === 200 && runBody.enqueued === true
    );
    const consumedReportRuns: string[] = [];
    const consumed = await processNext(
      {
        "report.run": async (event: ClaimedEvent) => {
          consumedReportRuns.push(event.id);
        },
      },
      {
        bus: new PostgresEventBus(app),
        workers: new PostgresWorkerRegistry(app),
        audit: { emit: async () => {}, query: async () => [] },
      },
      { workerId, workerKind: "scheduled-job-route-proof", batch: 10 }
    );
    check(
      "report.run event published by run-now is consumed by the worker",
      consumed.processed === 1 && consumedReportRuns.length === 1
    );
    check(
      "run-now rejects an invalid job id",
      (await invoke(runR, { params: { jobId: "nope" } })).status === 400
    );

    const patch = await invoke(patchR, { params: { jobId }, body: { enabled: false } });
    const patchBody = patch.body as { enabled?: boolean };
    check(
      "pause toggles enabled via the real handler",
      patch.status === 200 && patchBody.enabled === false
    );
  } catch (err) {
    check(
      "live scheduled-job route proof",
      false,
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    if (orgA)
      await su.query("DELETE FROM public.organisations WHERE id=$1", [orgA]).catch(() => {});
    await su
      .query("DELETE FROM public.worker_heartbeats WHERE worker_id=$1", [workerId])
      .catch(() => {});
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
