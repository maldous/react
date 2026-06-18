/**
 * Notification dispatch + routes LIVE proof (ADR-0068 / ADR-ACT-0260).
 *
 * Exercises the REAL BFF route handlers against live Postgres:
 *   GET   /api/me/profile, PATCH /api/me/profile
 *   GET   /api/me/notification-preferences, PATCH /api/me/notification-preferences
 *   GET   /api/admin/notifications/readiness
 *   POST  /api/admin/tenants/:tenantId/notifications/test
 *
 * Proves: own-profile read/update through the handler; preference read/write; the
 * operator test-notification dispatches an ENABLED channel (sent) and SUPPRESSES a
 * disabled one (logged), using the LOCAL adapter; secret payload rejected at dispatch;
 * readiness lists local channels; no secret fields in responses; access-control metadata.
 *
 * Tenant context resolved from the Host header ({slug}.APEX_DOMAIN).
 * SKIPs honestly (exit 0) if Postgres is unavailable; never fake-PASSes.
 * Usage: npm run proof:notification-dispatch   (requires `make compose-up-default`)
 */

import http from "node:http";
import pg from "pg";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { routes } from "../src/server/routes.ts";
import type { PipelineRequest, PipelineResponse, Route } from "../src/server/pipeline.ts";
import type { AuditEventPort } from "@platform/audit-events";
import { PostgresNotificationRepository } from "../src/adapters/postgres-notification-repository.ts";
import { dispatchNotification } from "../src/usecases/notifications.ts";

loadLocalEnv();
const SU_URL = requireEnv("POSTGRES_URL");
const APP_URL = requireEnv("POSTGRES_APP_URL");
const APEX = process.env["APEX_DOMAIN"] ?? "aldous.info";
const SECRET_FIELD = /secret|password|credential|private[_-]?key/i;
const noopAudit: AuditEventPort = { emit: async () => {}, query: async () => [] };

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
function findRoute(method: string, path: string): Route {
  const r = routes.find((x) => x.method === method && x.path === path);
  if (!r) throw new Error(`route not found: ${method} ${path}`);
  return r;
}
async function invoke(
  route: Route,
  opts: {
    params?: Record<string, string>;
    body?: unknown;
    host?: string;
    actor?: { userId: string; roles: string[]; permissions: string[] };
  }
): Promise<{ status: number; body: unknown }> {
  const captured = { status: 0, body: null as unknown };
  const req = {
    method: route.method,
    path: route.path,
    params: opts.params ?? {},
    requestId: "proof",
    body: opts.body ?? undefined,
    actor: opts.actor ? (opts.actor as never) : null,
    context: {} as never,
    raw: { headers: opts.host ? { host: opts.host } : {} } as unknown as http.IncomingMessage,
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
  console.log("# Notification dispatch + routes LIVE proof\n");
  if (!(await reachable(APP_URL))) {
    console.log("SKIP  notification-dispatch proof — Postgres not reachable");
    console.log("\n# SKIPPED (no live Postgres) — not counted as pass or fail");
    process.exit(0);
  }

  const meProfileGet = findRoute("GET", "/api/me/profile");
  const meProfilePatch = findRoute("PATCH", "/api/me/profile");
  const mePrefsGet = findRoute("GET", "/api/me/notification-preferences");
  const mePrefsPatch = findRoute("PATCH", "/api/me/notification-preferences");
  const readiness = findRoute("GET", "/api/admin/notifications/readiness");
  const testRoute = findRoute("POST", "/api/admin/tenants/:tenantId/notifications/test");
  check(
    "me routes are tenant-scoped + profile.read_self/update_self",
    meProfileGet.scope === "tenant" &&
      meProfileGet.requiredPermission === "profile.read_self" &&
      meProfilePatch.requiredPermission === "profile.update_self"
  );
  check(
    "notifications readiness/test are global + platform.notifications.read/write",
    readiness.scope === "global" &&
      readiness.requiredPermission === "platform.notifications.read" &&
      testRoute.requiredPermission === "platform.notifications.write"
  );

  const su = new pg.Pool({ connectionString: SU_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const notifRepo = new PostgresNotificationRepository(app);
  const userId = "proof-user-1";
  const user = {
    userId,
    roles: ["tenant-admin"],
    permissions: ["profile.read_self", "profile.update_self"],
  };
  const op = {
    userId: "op",
    roles: ["system-admin"],
    permissions: ["platform.notifications.read", "platform.notifications.write"],
  };
  let orgA: string | null = null;
  let slug = "";
  try {
    slug = "proof-nd-" + Date.now().toString(36);
    orgA = (
      await su.query<{ id: string }>(
        "INSERT INTO public.organisations (slug, display_name) VALUES ($1,$2) RETURNING id",
        [slug, "Proof ND"]
      )
    ).rows[0]!.id;
    const host = `${slug}.${APEX}`;

    // me/profile without tenant context → 400
    check(
      "me/profile without a tenant context is rejected",
      (await invoke(meProfileGet, { actor: user })).status === 400
    );

    // update + read own profile via real handlers
    const upd = await invoke(meProfilePatch, {
      host,
      actor: user,
      body: { displayName: "Grace", locale: "en-GB", timezone: "UTC" },
    });
    check(
      "own profile update via real handler (200)",
      upd.status === 200 && (upd.body as { displayName?: string }).displayName === "Grace"
    );
    const get = await invoke(meProfileGet, { host, actor: user });
    check(
      "own profile read returns the update",
      (get.body as { displayName?: string }).displayName === "Grace"
    );
    // invalid profile rejected
    check(
      "invalid profile (empty name) rejected",
      (
        await invoke(meProfilePatch, {
          host,
          actor: user,
          body: { displayName: "", locale: "en-GB", timezone: "UTC" },
        })
      ).status === 400
    );

    // set preferences via real handler: email security enabled, webhook security disabled
    const prefsUpd = await invoke(mePrefsPatch, {
      host,
      actor: user,
      body: {
        preferences: [
          { channel: "email", category: "security", enabled: true },
          { channel: "webhook", category: "security", enabled: false },
        ],
      },
    });
    check("notification preferences update via real handler (200)", prefsUpd.status === 200);
    const prefsGet = await invoke(mePrefsGet, { host, actor: user });
    check(
      "notification preferences read back the update",
      ((prefsGet.body as { preferences?: unknown[] }).preferences?.length ?? 0) === 2
    );

    // readiness lists local channels
    const rd = await invoke(readiness, { actor: op });
    const rdBody = rd.body as { channels?: { available: boolean; transport: string }[] };
    check(
      "readiness lists local channels (available, never faked)",
      rd.status === 200 && !!rdBody.channels?.every((c) => c.available && /local/.test(c.transport))
    );

    // operator test send via real handler → email sent, webhook suppressed
    const test = await invoke(testRoute, {
      params: { tenantId: orgA },
      actor: op,
      body: { userId, category: "security" },
    });
    const dispatched =
      (test.body as { dispatched?: { channel: string; status: string }[] }).dispatched ?? [];
    const byChannel = Object.fromEntries(dispatched.map((d) => [d.channel, d.status]));
    check(
      "test send dispatches the enabled channel (sent)",
      test.status === 200 && byChannel["email"] === "sent"
    );
    check("test send suppresses the disabled channel", byChannel["webhook"] === "suppressed");
    check("test response carries no secret fields", !SECRET_FIELD.test(JSON.stringify(test.body)));
    check(
      "invalid tenant id rejected",
      (
        await invoke(testRoute, {
          params: { tenantId: "nope" },
          actor: op,
          body: { userId, category: "security" },
        })
      ).status === 400
    );

    // dispatch logged (durable) + secret payload rejected at the usecase
    const logCount = await notifRepo.countLog(orgA, userId);
    check("dispatch is logged durably", logCount >= 2);
    let secretThrew = false;
    try {
      await dispatchNotification(
        {
          organisationId: orgA,
          userId,
          category: "security",
          subject: "x",
          payload: { token: "leak" },
        },
        { notifications: notifRepo, audit: noopAudit },
        { operator: true }
      );
    } catch {
      secretThrew = true;
    }
    check("secret-bearing payload rejected at dispatch", secretThrew);
  } catch (err) {
    check(
      "live notification-dispatch proof",
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
    failures === 0 ? "\n# ALL CHECKS PASSED (live routes)" : `\n# ${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
