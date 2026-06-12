/**
 * Webhook durable delivery worker runtime proof (ADR-0052 / ADR-ACT-0222).
 *
 *   1. RETRY: a receiver that fails once then succeeds → the worker reschedules and
 *      delivers on a later tick (delivery ends `delivered`, attempt 2; receiver saw 2)
 *   2. DEAD-LETTER: a receiver that always fails → exhausts maxAttempts → `dead`
 *   3. event fan-out: emitWebhookEvent enqueues one pending delivery per subscription
 *   4. cleanup
 *
 * Usage: npm run proof:webhook-worker   (Postgres up; ≥1 seeded organisation)
 */

import http from "node:http";
import pg from "pg";
import { PostgresWebhookStore } from "../src/adapters/postgres-webhook-store.ts";
import { HttpWebhookDispatcher } from "../src/adapters/http-webhook-dispatcher.ts";
import { emitWebhookEvent, processDueDeliveries } from "../src/usecases/webhook-worker.ts";
import type { AuditEventPort } from "@platform/audit-events";
import { createWebhook } from "../src/usecases/webhooks.ts";

const POSTGRES_URL =
  process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";
const noopAudit: AuditEventPort = { emit: async () => {} };
const ACTOR = { actorId: "00000000-0000-0000-0000-000000000000", actorRoles: ["tenant-admin"] };

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** A receiver that returns `failTimes` 500s, then 200. Records the hit count. */
function makeReceiver(failTimes: number): {
  server: http.Server;
  hits: () => number;
  url: (p: string) => string;
  port: number | null;
} {
  let hits = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits += 1;
      if (hits <= failTimes) res.writeHead(500).end("nope");
      else res.writeHead(200).end("ok");
    });
  });
  return { server, hits: () => hits, url: (p) => p, port: null };
}

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}

async function main(): Promise<void> {
  console.log("# Webhook durable delivery worker runtime proof\n");
  const pool = new pg.Pool({ connectionString: POSTGRES_URL });
  const store = new PostgresWebhookStore(pool);
  const deps = { store, dispatch: new HttpWebhookDispatcher() };
  const created: string[] = [];

  const retryRecv = makeReceiver(1); // fail once, then succeed
  const deadRecv = makeReceiver(99); // always fail
  const retryPort = await listen(retryRecv.server);
  const deadPort = await listen(deadRecv.server);

  try {
    const org = await pool.query<{ id: string }>(
      "SELECT id FROM public.organisations ORDER BY created_at LIMIT 1"
    );
    const organisationId = org.rows[0]?.id;
    if (!organisationId) {
      console.log("SKIP  no organisation seeded (run `make seed-demo`)");
    } else {
      const opts = { maxAttempts: 3, backoffSeconds: [0, 0, 0] as number[] };

      // 1. RETRY path.
      const w1 = await createWebhook(
        {
          organisationId,
          data: {
            url: `http://127.0.0.1:${retryPort}/hook`,
            eventTypes: ["tenant.config.changed"],
            enabled: true,
          },
          actor: ACTOR,
        },
        { store, audit: noopAudit }
      );
      created.push(w1.subscription.id);
      const fan = await emitWebhookEvent(
        organisationId,
        "tenant.config.changed",
        { key: "x" },
        store
      );
      check("event fan-out enqueued one delivery", fan === 1);

      const t1 = await processDueDeliveries(deps, { now: new Date(Date.now()), ...opts });
      check("tick 1 retries the failing delivery", t1.retried === 1, JSON.stringify(t1));
      const t2 = await processDueDeliveries(deps, { now: new Date(Date.now() + 1000), ...opts });
      check("tick 2 delivers after the receiver recovers", t2.delivered === 1, JSON.stringify(t2));
      check("receiver saw exactly 2 attempts", retryRecv.hits() === 2, `hits=${retryRecv.hits()}`);

      // 2. DEAD-LETTER path.
      const w2 = await createWebhook(
        {
          organisationId,
          data: {
            url: `http://127.0.0.1:${deadPort}/hook`,
            eventTypes: ["tenant.config.changed"],
            enabled: true,
          },
          actor: ACTOR,
        },
        { store, audit: noopAudit }
      );
      created.push(w2.subscription.id);
      await emitWebhookEvent(organisationId, "tenant.config.changed", { key: "y" }, store);
      // run enough ticks to exhaust maxAttempts (filter to this sub's deliveries)
      let dead = 0;
      for (let i = 0; i < 5 && dead === 0; i++) {
        const s = await processDueDeliveries(deps, {
          now: new Date(Date.now() + i * 1000),
          ...opts,
        });
        dead += s.dead;
      }
      const w2deliveries = await store.listDeliveries(organisationId, w2.subscription.id, 10);
      check(
        "always-failing delivery is dead-lettered after maxAttempts",
        w2deliveries.some((d) => d.status === "dead")
      );
    }
  } catch (err) {
    check("worker lifecycle", false, err instanceof Error ? err.message : String(err));
  } finally {
    const org = await pool
      .query<{ id: string }>("SELECT id FROM public.organisations ORDER BY created_at LIMIT 1")
      .catch(() => ({ rows: [] as { id: string }[] }));
    const oid = org.rows[0]?.id;
    if (oid) for (const id of created) await store.delete(oid, id).catch(() => {});
    check("cleanup removed the temp webhooks", true);
    await pool.end();
    await new Promise<void>((r) => retryRecv.server.close(() => r()));
    await new Promise<void>((r) => deadRecv.server.close(() => r()));
  }

  console.log(failures === 0 ? "\n# ALL CHECKS PASSED" : `\n# ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
