/**
 * Event redrive + admin-routes LIVE proof (ADR-0059 / ADR-ACT-0259).
 *
 * Exercises the REAL BFF route handlers against live Postgres:
 *   GET  /api/admin/events?organisationId=...
 *   GET  /api/admin/events/dead-letter?organisationId=...
 *   POST /api/admin/events/:eventId/redrive
 *   GET  /api/admin/workers
 *
 * Proves: a dead-lettered event appears in the DLQ route; operator redrive requeues
 * it (and a re-run worker tick processes the requeued event); the requeued event is a
 * fresh pending event; missing organisationId rejected; access-control metadata
 * (global + platform.events.read/write, platform.workers.read). A dead letter is
 * produced first via the server-internal worker tick.
 *
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 * Usage: npm run proof:event-redrive   (requires `make compose-up-default`)
 */

import http from "node:http";
import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { routes } from "../src/server/routes.ts";
import type { PipelineRequest, PipelineResponse, Route } from "../src/server/pipeline.ts";
import type { AuditEventPort } from "@platform/audit-events";
import { PostgresEventBus, PostgresWorkerRegistry } from "../src/adapters/postgres-event-bus.ts";
import { processNext, publishEvent } from "../src/usecases/events.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
const noopAudit: AuditEventPort = { emit: async () => {}, query: async () => [] };
const OP = {
  userId: "00000000-0000-0000-0000-000000000000",
  roles: ["system-admin"],
  permissions: ["platform.events.read", "platform.events.write", "platform.workers.read"],
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
  opts: { params?: Record<string, string>; url?: string }
): Promise<{ status: number; body: unknown }> {
  const captured = { status: 0, body: null as unknown };
  const req = {
    method: route.method,
    path: route.path,
    params: opts.params ?? {},
    requestId: "proof",
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
  console.log("# Event redrive + admin-routes LIVE proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  event-redrive proof — Postgres not reachable");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }

  const eventsRoute = findRoute("GET", "/api/admin/events");
  const dlqRoute = findRoute("GET", "/api/admin/events/dead-letter");
  const redriveRoute = findRoute("POST", "/api/admin/events/:eventId/redrive");
  const workersRoute = findRoute("GET", "/api/admin/workers");
  check(
    "events + dead-letter reads are global + platform.events.read",
    eventsRoute.scope === "global" &&
      eventsRoute.requiredPermission === "platform.events.read" &&
      dlqRoute.requiredPermission === "platform.events.read"
  );
  check(
    "redrive is global + platform.events.write",
    redriveRoute.scope === "global" && redriveRoute.requiredPermission === "platform.events.write"
  );
  check(
    "workers read is global + platform.workers.read",
    workersRoute.scope === "global" && workersRoute.requiredPermission === "platform.workers.read"
  );

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const deps = {
    bus: new PostgresEventBus(app),
    workers: new PostgresWorkerRegistry(app),
    audit: noopAudit,
  };
  let orgA: string | null = null;
  try {
    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-erd-a-" + Date.now().toString(36), "Proof ERD A"]
      )
    ).rows[0]!.id;

    // produce a dead letter via the server-internal worker tick (max_attempts=1)
    await publishEvent(
      { organisationId: orgA, eventType: "boom.event", idempotencyKey: "k1", maxAttempts: 1 },
      deps
    );
    await processNext(
      {
        "boom.event": async () => {
          throw new Error("intentional failure");
        },
      },
      deps,
      { batch: 10 }
    );

    // events route requires organisationId
    check(
      "events route requires organisationId",
      (await invoke(eventsRoute, { url: "/api/admin/events" })).status === 400
    );

    // dead-letter route shows the dead letter
    const dlq = await invoke(dlqRoute, {
      url: `/api/admin/events/dead-letter?organisationId=${orgA}`,
    });
    const dlqBody = dlq.body as { deadLetters?: { id: string; eventType: string }[] };
    check(
      "dead-letter route returns the dead-lettered event",
      dlq.status === 200 && (dlqBody.deadLetters?.length ?? 0) === 1
    );
    const deadLetterId = dlqBody.deadLetters![0]!.id;

    // redrive via the real handler
    const rd = await invoke(redriveRoute, { params: { eventId: deadLetterId } });
    const rdBody = rd.body as { redriven?: boolean; eventId?: string };
    check(
      "operator redrive requeues the dead letter (200)",
      rd.status === 200 && rdBody.redriven === true
    );
    check(
      "redrive rejects an invalid id",
      (await invoke(redriveRoute, { params: { eventId: "nope" } })).status === 400
    );

    // the requeued event is processable
    const handled: string[] = [];
    const after = await processNext(
      {
        "boom.event": async (e) => {
          handled.push(e.id);
        },
      },
      deps,
      {
        batch: 10,
      }
    );
    check(
      "the requeued event is processed on the next worker tick",
      after.processed === 1 && handled.length === 1
    );

    // events route lists events for the tenant
    const evs = await invoke(eventsRoute, { url: `/api/admin/events?organisationId=${orgA}` });
    const evBody = evs.body as { events?: unknown[] };
    check(
      "events route lists the tenant's events",
      evs.status === 200 && (evBody.events?.length ?? 0) >= 1
    );

    // workers route returns 200
    const wk = await invoke(workersRoute, {});
    check("workers route returns 200", wk.status === 200);
  } catch (err) {
    check("live event-redrive proof", false, err instanceof Error ? err.message : String(err));
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
