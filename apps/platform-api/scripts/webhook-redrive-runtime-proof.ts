/**
 * Webhook dead-letter redrive + metrics runtime proof (ADR-ACT-0226).
 *
 * Against live Postgres + a local receiver, end to end:
 *   1. event fan-out enqueues a delivery; the receiver fails until the delivery is DEAD
 *   2. metrics show dead=1, lastStatus=dead
 *   3. operator REDRIVE requeues the dead delivery as pending (attempt reset)
 *   4. the receiver recovers; the worker delivers the redriven delivery
 *   5. metrics update to delivered (dead=0)
 *   6. the signing secret is never printed; cleanup removes the temp org+webhook
 *
 * Usage: npm run proof:webhook-redrive   (Postgres up via make compose-up-default)
 */

import http from "node:http";
import { requireEnv } from "./lib/local-env.ts";
import pg from "pg";
import type { AuditEventPort } from "@platform/audit-events";
import { PostgresWebhookStore } from "../src/adapters/postgres-webhook-store.ts";
import { HttpWebhookDispatcher } from "../src/adapters/http-webhook-dispatcher.ts";
import {
  createWebhook,
  getSubscriptionMetrics,
  redriveDeadDeliveries,
} from "../src/usecases/webhooks.ts";
import { emitWebhookEvent, processDueDeliveries } from "../src/usecases/webhook-worker.ts";

const POSTGRES_URL = requireEnv("POSTGRES_URL");
const noopAudit: AuditEventPort = { emit: async () => {} };
const ACTOR = { actorId: "00000000-0000-0000-0000-000000000000", actorRoles: ["tenant-admin"] };
const OPTS = { maxAttempts: 2, backoffSeconds: [0, 0] as number[] };

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}

async function main(): Promise<void> {
  console.log("# Webhook dead-letter redrive + metrics runtime proof\n");

  // Receiver: fails (500) until `recovered`, then 200.
  let recovered = false;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => res.writeHead(recovered ? 200 : 500).end(recovered ? "ok" : "no"));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  const pool = new pg.Pool({ connectionString: POSTGRES_URL });
  const store = new PostgresWebhookStore(pool);
  const deps = { store, dispatch: new HttpWebhookDispatcher() };
  let orgId: string | null = null;
  let subId = "";
  try {
    const org = await pool.query<{ id: string }>(
      `INSERT INTO public.organisations (slug, display_name)
       VALUES ($1, 'Redrive Proof') RETURNING id`,
      [`redrive-proof-${Date.now()}`]
    );
    orgId = org.rows[0]!.id;

    const created = await createWebhook(
      {
        organisationId: orgId,
        data: {
          url: `http://127.0.0.1:${port}/hook`,
          eventTypes: ["tenant.config.changed"],
          enabled: true,
        },
        actor: ACTOR,
      },
      { store, audit: noopAudit, genSecret: () => "whsec_redrive_proof" }
    );
    subId = created.subscription.id;

    // 1. Fan out + drive to DEAD (receiver failing).
    await emitWebhookEvent(orgId, "tenant.config.changed", { key: "x" }, store);
    await processDueDeliveries(deps, { now: new Date(Date.now()), ...OPTS }); // attempt1 → retry
    await processDueDeliveries(deps, { now: new Date(Date.now() + 1000), ...OPTS }); // attempt2 → dead

    const m1 = await getSubscriptionMetrics(orgId, subId, store);
    check("delivery driven to dead", m1?.dead === 1, `dead=${m1?.dead}`);
    check(
      "metrics lastStatus reflects dead",
      m1?.lastStatus === "dead",
      `lastStatus=${m1?.lastStatus}`
    );

    // 2. Find the dead delivery + REDRIVE it (single).
    const deliveries = await store.listDeliveries(orgId, subId, 10);
    const deadId = deliveries.find((d) => d.status === "dead")?.id ?? "";
    recovered = true; // receiver now recovers
    const redrive = await redriveDeadDeliveries(
      { organisationId: orgId, subscriptionId: subId, deliveryId: deadId, actor: ACTOR },
      { store, audit: noopAudit }
    );
    check("redrive requeued the dead delivery", redrive.kind === "ok" && redrive.redriven === 1);

    const mid = await getSubscriptionMetrics(orgId, subId, store);
    check(
      "after redrive: dead=0, pending=1",
      mid?.dead === 0 && mid?.pending === 1,
      `dead=${mid?.dead} pending=${mid?.pending}`
    );

    // 3. Worker delivers the redriven delivery.
    await processDueDeliveries(deps, { now: new Date(Date.now() + 2000), ...OPTS });
    const m2 = await getSubscriptionMetrics(orgId, subId, store);
    check(
      "redriven delivery now delivered",
      m2?.delivered === 1 && m2?.dead === 0,
      `delivered=${m2?.delivered} dead=${m2?.dead}`
    );
    check("metrics lastSuccessAt is set", m2?.lastSuccessAt !== null);

    // 4. No secret leakage anywhere we control.
    const metricsBlob = JSON.stringify(m2);
    check("metrics carry no secret", !metricsBlob.includes("whsec_redrive_proof"));
  } catch (err) {
    check("redrive lifecycle", false, err instanceof Error ? err.message : String(err));
  } finally {
    if (orgId)
      await pool.query(`DELETE FROM public.organisations WHERE id = $1`, [orgId]).catch(() => {});
    await pool.end();
    await new Promise<void>((r) => server.close(() => r()));
  }

  console.log(failures === 0 ? "\n# ALL CHECKS PASSED" : `\n# ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
