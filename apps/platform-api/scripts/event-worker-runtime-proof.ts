/**
 * Event worker LIVE Postgres proof (ADR-0059 / ADR-ACT-0259).
 *
 * Proves the durable worker runtime against the local Compose Postgres: a worker
 * claims and processes a pending event (status → processed); a processed event is
 * never re-claimed (idempotent processing); a failing handler retries and then
 * dead-letters at max_attempts; the worker heartbeat is recorded + visible.
 *
 * Runs repos as platform_app (RLS enforces). Creates + cleans up its own org.
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 *
 * Usage: npm run proof:event-worker   (requires `make compose-up-default`)
 */

import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import type { AuditEventPort } from "@platform/audit-events";
import { PostgresEventBus, PostgresWorkerRegistry } from "../src/adapters/postgres-event-bus.ts";
import type { ClaimedEvent } from "../src/ports/event-bus.ts";
import { getDeadLetters, listWorkers, processNext, publishEvent } from "../src/usecases/events.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
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
  console.log("# Event worker LIVE Postgres proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  event-worker proof — Postgres not reachable");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const deps = {
    bus: new PostgresEventBus(app),
    workers: new PostgresWorkerRegistry(app),
    audit: noopAudit,
  };
  let orgA: string | null = null;
  const token = Date.now().toString(36);
  const workerId = "proof-worker-" + token;
  const okEvent = `ok.event.${token}`;
  const boomEvent = `boom.event.${token}`;
  const missingHandlerEvent = `no.handler.${token}`;

  try {
    await su.query(
      "UPDATE public.platform_events SET status='failed', updated_at=now() WHERE status IN ('pending', 'processing')"
    );
    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-ew-a-" + Date.now().toString(36), "Proof EW A"]
      )
    ).rows[0]!.id;

    // happy path: publish → worker consumes → processed
    await publishEvent({ organisationId: orgA, eventType: okEvent, idempotencyKey: "k1" }, deps);
    const handled: string[] = [];
    const okHandlers = {
      [okEvent]: async (e: ClaimedEvent) => {
        handled.push(e.id);
      },
    };
    const r1 = await processNext(okHandlers, deps, {
      workerId,
      workerKind: "event-worker",
      batch: 10,
    });
    check(
      "worker claims and processes a pending event",
      r1.processed === 1 && handled.length === 1
    );

    // idempotent processing: a processed event is never re-claimed
    const r2 = await processNext(okHandlers, deps, { batch: 10 });
    check("a processed event is not re-claimed (idempotent processing)", r2.claimed === 0);

    // failure path: max_attempts=2 → retry once, then dead-letter
    await publishEvent(
      { organisationId: orgA, eventType: boomEvent, idempotencyKey: "k2", maxAttempts: 2 },
      deps
    );
    const boomHandlers = {
      [boomEvent]: async () => {
        throw new Error("intentional handler failure");
      },
    };
    const f1 = await processNext(boomHandlers, deps, { batch: 10 });
    check(
      "first failure retries (event returned to pending)",
      f1.retried === 1 && f1.deadLettered === 0
    );
    const f2 = await processNext(boomHandlers, deps, { batch: 10 });
    check("second failure dead-letters at max_attempts", f2.deadLettered === 1);
    const dlq = await getDeadLetters(orgA, deps);
    check("the failed event is in the dead-letter queue", dlq.deadLetters.length === 1);

    // Unknown event types are not silently dropped: publish no.handler, consume it
    // with an empty handler registry, and prove it reaches DLQ at max_attempts.
    await publishEvent(
      {
        organisationId: orgA,
        eventType: missingHandlerEvent,
        idempotencyKey: "k3",
        maxAttempts: 1,
      },
      deps
    );
    const missingHandler = await processNext({}, deps, { batch: 10 });
    const dlqAfterMissingHandler = await getDeadLetters(orgA, deps);
    check(
      "no.handler publish is consumed by the worker and dead-lettered when no handler exists",
      missingHandler.claimed === 1 &&
        missingHandler.deadLettered === 1 &&
        dlqAfterMissingHandler.deadLetters.some((e) => e.eventType === missingHandlerEvent)
    );

    // heartbeat visible
    const workers = await listWorkers(deps);
    check(
      "worker heartbeat is recorded and visible with a liveness status",
      workers.workers.some((w) => w.workerId === workerId && w.status === "alive")
    );
  } catch (err) {
    check("live event-worker proof", false, err instanceof Error ? err.message : String(err));
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
    failures === 0 ? "\n# ALL CHECKS PASSED (live Postgres)" : `\n# ${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
