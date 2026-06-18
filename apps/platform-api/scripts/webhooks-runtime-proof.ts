/**
 * Tenant Webhooks runtime proof (ADR-0051 / ADR-ACT-0221).
 *
 *   1. pure HMAC signing is verifiable; readiness classifier honest
 *   2. LIVE: create a temp webhook → send a test event through the real HTTP
 *      dispatcher to a local receiver → verify the receiver got a correctly SIGNED
 *      platform.test payload → verify the delivery log → cleanup
 *
 * Usage: npm run proof:webhooks   (requires Postgres up; needs ≥1 seeded organisation)
 */

import http from "node:http";
import { requireEnv } from "./lib/local-env.ts";
import crypto from "node:crypto";
import pg from "pg";
import type { AuditEventPort } from "@platform/audit-events";
import { PostgresWebhookStore } from "../src/adapters/postgres-webhook-store.ts";
import { HttpWebhookDispatcher } from "../src/adapters/http-webhook-dispatcher.ts";
import {
  classifyWebhookReadiness,
  createWebhook,
  listWebhookDeliveries,
  signWebhookBody,
  testWebhook,
} from "../src/usecases/webhooks.ts";

const POSTGRES_URL = requireEnv("POSTGRES_URL");
const noopAudit: AuditEventPort = { emit: async () => {} };
const ACTOR = { actorId: "00000000-0000-0000-0000-000000000000", actorRoles: ["tenant-admin"] };

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}

function checkPureHmacAndReadiness(): void {
  check(
    "HMAC signing is verifiable",
    signWebhookBody("s", 1, "b") === crypto.createHmac("sha256", "s").update("1.b").digest("hex")
  );
  check(
    "readiness: enabled subscription → configured",
    classifyWebhookReadiness({ total: 1, enabled: 1 }) === "configured"
  );
}

function startReceiver(): {
  server: http.Server;
  received: { headers: http.IncomingHttpHeaders; body: string }[];
} {
  const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.writeHead(200).end("ok");
    });
  });
  return { server, received };
}

function verifyDelivery(
  received: { headers: http.IncomingHttpHeaders; body: string }[],
  secret: string
): void {
  const got = received[0];
  check("local receiver got exactly one delivery", received.length === 1);
  if (got) {
    const sigHeader = String(got.headers["x-platform-signature"] ?? "");
    const m = /^t=(\d+),v1=([0-9a-f]+)$/.exec(sigHeader);
    const verified = !!m && m[2] === signWebhookBody(secret, Number(m[1]), got.body);
    check("received payload is correctly HMAC-signed (verified vs secret)", verified);
    check("payload does not contain the secret", !got.body.includes(secret));
    check("event header is platform.test", got.headers["x-platform-event"] === "platform.test");
  }
}

async function runLifecycle(deps: {
  organisationId: string;
  url: string;
  store: PostgresWebhookStore;
  secret: string;
  received: { headers: http.IncomingHttpHeaders; body: string }[];
  setCreatedId: (id: string | null) => void;
}): Promise<void> {
  const { organisationId, url, store, secret, received, setCreatedId } = deps;
  const created = await createWebhook(
    {
      organisationId,
      data: { url, eventTypes: ["platform.test"], enabled: true },
      actor: ACTOR,
    },
    { store, audit: noopAudit, genSecret: () => secret }
  );
  const createdId = created.subscription.id;
  setCreatedId(createdId);
  check("created webhook reveals the secret once", created.secret === secret);

  const test = await testWebhook(
    { organisationId, id: createdId, actor: ACTOR },
    { store, audit: noopAudit, dispatch: new HttpWebhookDispatcher() }
  );
  check(
    "test dispatch delivered (HTTP 200)",
    test.kind === "ok" && test.result.status === "delivered"
  );

  verifyDelivery(received, secret);

  const deliveries = await listWebhookDeliveries(organisationId, createdId, store);
  check(
    "delivery log records a delivered attempt",
    deliveries.kind === "ok" && deliveries.deliveries.some((d) => d.status === "delivered")
  );

  // cleanup
  const removed = await store.delete(organisationId, createdId);
  const gone = (await store.get(organisationId, createdId)) === null;
  setCreatedId(null);
  check("cleanup removed the temp webhook", removed && gone);
}

async function main(): Promise<void> {
  console.log("# Tenant webhooks runtime proof\n");

  // 1. Pure.
  checkPureHmacAndReadiness();

  // 2. Live: a local receiver captures the signed delivery.
  const { server, received } = startReceiver();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/hook`;

  const pool = new pg.Pool({ connectionString: POSTGRES_URL });
  const store = new PostgresWebhookStore(pool);
  let createdId: string | null = null;
  const SECRET = "whsec_proofsecret";
  try {
    const org = await pool.query<{ id: string }>(
      "SELECT id FROM public.organisations ORDER BY created_at LIMIT 1"
    );
    const organisationId = org.rows[0]?.id;
    if (!organisationId) {
      console.log("SKIP  live lifecycle — no organisation seeded (run `make seed-demo`)");
    } else {
      await runLifecycle({
        organisationId,
        url,
        store,
        secret: SECRET,
        received,
        setCreatedId: (id) => {
          createdId = id;
        },
      });
    }
  } catch (err) {
    check("live lifecycle", false, err instanceof Error ? err.message : String(err));
    if (createdId) {
      const org = await pool
        .query<{ id: string }>("SELECT id FROM public.organisations ORDER BY created_at LIMIT 1")
        .catch(() => ({ rows: [] as { id: string }[] }));
      const oid = org.rows[0]?.id;
      if (oid) await store.delete(oid, createdId).catch(() => {});
    }
  } finally {
    await pool.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log(failures === 0 ? "\n# ALL CHECKS PASSED" : `\n# ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
