/**
 * Notification WEBHOOK transport LIVE proof (ADR-0068 / ADR-ACT-0273 — Phase 6.5).
 *
 * Proves the real webhook NotificationTransport against a local HTTP receiver:
 *  - an ENABLED (user, billing, webhook) preference POSTs a real signed request that the
 *    receiver actually gets, with a VALID ADR-0052 X-Platform-Signature, and is logged sent;
 *  - the request body carries NO secret field (only event/subject/ids);
 *  - a non-2xx receiver response reports `failed`;
 *  - a missing destination reports `failed` (never a faked sent).
 *
 * Requires Postgres (for prefs/log); spins its own local receiver. SKIPs if PG down.
 * Usage: npm run proof:notification-webhook-transport
 */

import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";
import { loadLocalEnv } from "./lib/local-env.ts";
import type { AuditEvent, AuditEventPort } from "@platform/audit-events";
import { PostgresNotificationRepository } from "../src/adapters/postgres-notification-repository.ts";
import { HttpWebhookDispatcher } from "../src/adapters/http-webhook-dispatcher.ts";
import {
  ConfiguredNotificationRecipientResolver,
  createWebhookTransport,
} from "../src/adapters/notification-transports.ts";
import { dispatchNotification } from "../src/usecases/notifications.ts";

loadLocalEnv();
const SU_URL =
  process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";
const APP_URL =
  process.env["POSTGRES_APP_URL"] ??
  "postgresql://platform_app:platformapppassword@localhost:5433/platform";
const SECRET = "whsec_proof_" + crypto.randomBytes(8).toString("hex");
const SECRET_FIELD = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
function capturingAudit(): AuditEventPort {
  const events: AuditEvent[] = [];
  return { emit: async (e) => void events.push(e), query: async () => events };
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
function verifySignature(header: string, body: string): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]+)$/.exec(header);
  if (!m) return false;
  const expected = crypto.createHmac("sha256", SECRET).update(`${m[1]}.${body}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(m[2]!));
}

async function main(): Promise<void> {
  console.log("# Notification WEBHOOK transport LIVE proof (local receiver)\n");
  if (!(await pgReachable(APP_URL))) {
    console.log("SKIP  notification-webhook-transport — Postgres not reachable");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }

  // Local receiver: captures the last POST; /bad returns 500.
  const received: { sig: string | null; event: string | null; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/bad") {
        res.writeHead(500).end("nope");
        return;
      }
      received.push({
        sig: (req.headers["x-platform-signature"] as string) ?? null,
        event: (req.headers["x-platform-event"] as string) ?? null,
        body,
      });
      res.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  const base = `http://127.0.0.1:${addr.port}`;

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const repo = new PostgresNotificationRepository(app);
  const userId = "user-" + Date.now().toString(36);
  let orgA: string | null = null;

  try {
    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-nwx-" + Date.now().toString(36), "Proof NWx"]
      )
    ).rows[0]!.id;
    await repo.upsertPreferences({
      organisationId: orgA,
      userId,
      preferences: [{ channel: "webhook", category: "billing", enabled: true }],
    });

    const transport = createWebhookTransport({
      resolver: new ConfiguredNotificationRecipientResolver({ webhookUrl: base + "/hook" }),
      dispatch: new HttpWebhookDispatcher(),
      secret: SECRET,
    });
    const deps = {
      notifications: repo,
      audit: capturingAudit(),
      transports: { webhook: transport },
    };

    const r1 = await dispatchNotification(
      { organisationId: orgA, userId, category: "billing", subject: "Invoice ready" },
      deps,
      { operator: true }
    );
    check(
      "enabled webhook dispatch reports sent",
      r1.some((x) => x.channel === "webhook" && x.status === "sent")
    );
    check("receiver actually got the POST", received.length === 1);
    const got = received[0];
    check(
      "request carried a valid ADR-0052 signature",
      !!got && !!got.sig && verifySignature(got.sig, got.body)
    );
    check("event header is notification.<category>", got?.event === "notification.billing");
    check("body carries no secret field", !!got && !SECRET_FIELD.test(got.body));

    // non-2xx → failed
    const badTransport = createWebhookTransport({
      resolver: new ConfiguredNotificationRecipientResolver({ webhookUrl: base + "/bad" }),
      dispatch: new HttpWebhookDispatcher(),
      secret: SECRET,
    });
    const stBad = await badTransport({
      organisationId: orgA,
      userId,
      channel: "webhook",
      category: "billing",
      subject: "x",
    });
    check("non-2xx receiver reports failed", stBad === "failed");

    // missing destination → failed
    const noDest = createWebhookTransport({
      resolver: new ConfiguredNotificationRecipientResolver({}),
      dispatch: new HttpWebhookDispatcher(),
      secret: SECRET,
    });
    const stNone = await noDest({
      organisationId: orgA,
      userId,
      channel: "webhook",
      category: "billing",
      subject: "x",
    });
    check("missing destination reports failed (never faked sent)", stNone === "failed");
  } catch (err) {
    check(
      "notification webhook transport proof",
      false,
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    if (orgA)
      await su.query("DELETE FROM public.organisations WHERE id=$1", [orgA]).catch(() => {});
    await app.end().catch(() => {});
    await su.end().catch(() => {});
    await new Promise<void>((r) => server.close(() => r()));
  }

  console.log(
    failures === 0
      ? "\n# ALL CHECKS PASSED (live receiver + Postgres)"
      : `\n# ${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
