/**
 * Notification EMAIL transport LIVE proof (ADR-0068 / ADR-ACT-0273 — Phase 6.5).
 *
 * Proves the real email NotificationTransport against the local Compose Mailpit:
 *  - an ENABLED (user, billing, email) preference DELIVERS a real SMTP message that
 *    actually lands in Mailpit (verified via the Mailpit API) and is logged `sent`;
 *  - a DISABLED preference SUPPRESSES dispatch (no new Mailpit message; logged suppressed);
 *  - a recipient that cannot be resolved reports `failed` (never a faked sent).
 *
 * Requires Postgres + Mailpit (SMTP 1025 + API 8025). SKIPs honestly if unavailable.
 * Usage: npm run proof:notification-email-transport
 */

import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import type { AuditEvent, AuditEventPort } from "@platform/audit-events";
import { PostgresNotificationRepository } from "../src/adapters/postgres-notification-repository.ts";
import { SmtpEmailAdapter } from "../src/adapters/smtp-email-adapter.ts";
import {
  ConfiguredNotificationRecipientResolver,
  createEmailTransport,
} from "../src/adapters/notification-transports.ts";
import { dispatchNotification } from "../src/usecases/notifications.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
const SMTP_PORT = Number(process.env["MAILPIT_SMTP_PORT"] ?? 1025);
const MAILPIT_API = process.env["MAILPIT_API"] ?? "http://localhost:8025/mailpit";
const UNIQUE = "ProofEmail-" + Date.now().toString(36);

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
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
async function mailpitReachable(): Promise<boolean> {
  try {
    return (await fetch(`${MAILPIT_API}/api/v1/info`)).ok;
  } catch {
    return false;
  }
}
async function mailpitMatches(query: string): Promise<number> {
  try {
    const res = await fetch(`${MAILPIT_API}/api/v1/search?query=${encodeURIComponent(query)}`);
    if (!res.ok) return 0;
    const body = (await res.json()) as { messages_count?: number; total?: number };
    return Number(body.messages_count ?? body.total ?? 0);
  } catch {
    return 0;
  }
}

async function main(): Promise<void> {
  console.log("# Notification EMAIL transport LIVE proof (Mailpit)\n");
  const [pgOk, mpOk] = await Promise.all([pgReachable(APP_URL), mailpitReachable()]);
  if (!pgOk || !mpOk) {
    const missing = [!pgOk ? "Postgres" : null, !mpOk ? "Mailpit" : null]
      .filter(Boolean)
      .join(" + ");
    console.log(
      `SKIP  notification-email-transport — ${missing} not reachable (\`make compose-up-default\`)`
    );
    console.log("\n# SKIPPED (no live backend) — not counted as pass or fail");
    process.exit(0);
  }

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const repo = new PostgresNotificationRepository(app);
  const toAddr = `proof-${Date.now().toString(36)}@mailpit.local`;
  const transport = createEmailTransport({
    resolver: new ConfiguredNotificationRecipientResolver({ emailOverride: toAddr }),
    email: new SmtpEmailAdapter({ host: "localhost", port: SMTP_PORT, secure: false }),
    from: { address: "notifications@platform.local" },
  });
  const deps = { notifications: repo, audit: capturingAudit(), transports: { email: transport } };
  const userId = "user-" + Date.now().toString(36);
  let orgA: string | null = null;

  try {
    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-ntx-" + Date.now().toString(36), "Proof NTx"]
      )
    ).rows[0]!.id;

    // enabled email/billing → real send to Mailpit
    await repo.upsertPreferences({
      organisationId: orgA,
      userId,
      preferences: [{ channel: "email", category: "billing", enabled: true }],
    });
    const before = await mailpitMatches(UNIQUE);
    const r1 = await dispatchNotification(
      { organisationId: orgA, userId, category: "billing", subject: UNIQUE },
      deps,
      { operator: true }
    );
    check(
      "enabled email dispatch reports sent",
      r1.some((x) => x.channel === "email" && x.status === "sent")
    );
    // poll Mailpit for the delivered message
    let delivered = 0;
    for (let i = 0; i < 10 && delivered <= before; i++) {
      delivered = await mailpitMatches(UNIQUE);
      if (delivered > before) break;
      await new Promise((res) => setTimeout(res, 300));
    }
    check(
      "the email actually landed in Mailpit (real SMTP delivery)",
      delivered > before,
      `count=${delivered}`
    );

    // disabled → suppressed, no new Mailpit message
    await repo.upsertPreferences({
      organisationId: orgA,
      userId,
      preferences: [{ channel: "email", category: "security", enabled: false }],
    });
    const SUPPRESS = "ProofSuppress-" + Date.now().toString(36);
    const r2 = await dispatchNotification(
      { organisationId: orgA, userId, category: "security", subject: SUPPRESS },
      deps,
      { operator: true }
    );
    check(
      "disabled email preference suppresses dispatch",
      r2.some((x) => x.channel === "email" && x.status === "suppressed")
    );
    await new Promise((res) => setTimeout(res, 500));
    check(
      "suppressed notification did NOT deliver to Mailpit",
      (await mailpitMatches(SUPPRESS)) === 0
    );

    // missing recipient → failed (no override, no domain)
    const failTransport = createEmailTransport({
      resolver: new ConfiguredNotificationRecipientResolver({}),
      email: new SmtpEmailAdapter({ host: "localhost", port: SMTP_PORT, secure: false }),
      from: { address: "notifications@platform.local" },
    });
    const st = await failTransport({
      organisationId: orgA,
      userId,
      channel: "email",
      category: "billing",
      subject: "no-recipient",
    });
    check("unresolvable recipient reports failed (never faked sent)", st === "failed");
  } catch (err) {
    check(
      "notification email transport proof",
      false,
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    if (orgA)
      await su.query("DELETE FROM public.organisations WHERE id=$1", [orgA]).catch(() => {});
    await app.end().catch(() => {});
    await su.end().catch(() => {});
  }

  console.log(
    failures === 0
      ? "\n# ALL CHECKS PASSED (live Mailpit + Postgres)"
      : `\n# ${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
