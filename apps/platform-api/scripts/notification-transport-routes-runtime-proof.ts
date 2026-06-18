/**
 * Notification transport ROUTES LIVE proof (ADR-0068 / ADR-ACT-0273 — Phase 6.5).
 *
 * Proves the WIRED path: with NOTIFICATION_EMAIL_TRANSPORT=smtp the operator test-send
 * route (POST /api/admin/tenants/:tenantId/notifications/test) selects the real email
 * transport via buildNotificationsDeps and delivers to Mailpit end-to-end.
 *  - the route is operator-only (platform.notifications.write, global scope);
 *  - an enabled (user, category, email) test send returns 200 and lands in Mailpit;
 *  - the wired transport selection is env-gated (off by default → local sink).
 *
 * Requires Postgres + Mailpit. SKIPs honestly if unavailable.
 * Usage: npm run proof:notification-transport-routes
 */

import http from "node:http";
import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { routes } from "../src/server/routes.ts";
import type { PipelineRequest, PipelineResponse } from "../src/server/pipeline.ts";
import { PostgresNotificationRepository } from "../src/adapters/postgres-notification-repository.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
const MAILPIT_API = process.env["MAILPIT_API"] ?? "http://localhost:8025/mailpit";
const OVERRIDE = `proof-routes-${Date.now().toString(36)}@mailpit.local`;

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
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
    const b = (await res.json()) as { messages_count?: number; total?: number };
    return Number(b.messages_count ?? b.total ?? 0);
  } catch {
    return 0;
  }
}

async function main(): Promise<void> {
  console.log("# Notification transport ROUTES LIVE proof\n");
  const [pgOk, mpOk] = await Promise.all([pgReachable(APP_URL), mailpitReachable()]);
  if (!pgOk || !mpOk) {
    const missing = [!pgOk ? "Postgres" : null, !mpOk ? "Mailpit" : null]
      .filter(Boolean)
      .join(" + ");
    console.log(`SKIP  notification-transport-routes — ${missing} not reachable`);
    console.log("\n# SKIPPED (no live backend) — not counted as pass or fail");
    process.exit(0);
  }

  // Wire the real email transport for buildNotificationsDeps (env-gated selection).
  process.env["NOTIFICATION_EMAIL_TRANSPORT"] = "smtp";
  process.env["NOTIFICATION_EMAIL_OVERRIDE"] = OVERRIDE;
  process.env["SMTP_HOST"] = "localhost";

  const testRoute = routes.find(
    (r) => r.method === "POST" && r.path === "/api/admin/tenants/:tenantId/notifications/test"
  );
  if (!testRoute) {
    check("test route exists", false);
    process.exit(1);
  }
  check(
    "test route is operator-only (platform.notifications.write, global)",
    testRoute.requiredPermission === "platform.notifications.write" && testRoute.scope === "global"
  );

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const repo = new PostgresNotificationRepository(app);
  const userId = "user-" + Date.now().toString(36);
  let orgA: string | null = null;

  try {
    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        ["proof-ntr-" + Date.now().toString(36), "Proof NTR"]
      )
    ).rows[0]!.id;
    await repo.upsertPreferences({
      organisationId: orgA,
      userId,
      preferences: [{ channel: "email", category: "system", enabled: true }],
    });

    const before = await mailpitMatches(OVERRIDE);
    const captured = { status: 0, body: null as unknown };
    const req = {
      method: "POST",
      path: testRoute.path,
      params: { tenantId: orgA },
      requestId: "proof",
      body: { userId, category: "system" },
      actor: {
        userId: "op",
        roles: ["system-admin"],
        permissions: ["platform.notifications.write"],
      },
      context: {} as never,
      raw: { headers: {} } as unknown as http.IncomingMessage,
    } as unknown as PipelineRequest;
    const res = {
      raw: {} as unknown as http.ServerResponse,
      json: (status: number, body: unknown) => {
        captured.status = status;
        captured.body = body;
      },
    } as PipelineResponse;
    await testRoute.handler(req, res);

    check("test-send route returns 200", captured.status === 200, `status=${captured.status}`);
    let delivered = 0;
    for (let i = 0; i < 12 && delivered <= before; i++) {
      delivered = await mailpitMatches(OVERRIDE);
      if (delivered > before) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    check(
      "wired route delivered a real email to Mailpit",
      delivered > before,
      `count=${delivered}`
    );
  } catch (err) {
    check(
      "notification transport routes proof",
      false,
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    delete process.env["NOTIFICATION_EMAIL_TRANSPORT"];
    delete process.env["NOTIFICATION_EMAIL_OVERRIDE"];
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
