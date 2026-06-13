import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type AuditEvent, type AuditEventPort } from "@platform/audit-events";
import {
  dispatchNotification,
  getMyPreferences,
  getNotificationReadiness,
  sendTestNotification,
  updateMyPreferences,
} from "../../src/usecases/notifications.ts";
import type {
  LogDispatchInput,
  NotificationRepository,
  PreferenceRecord,
  UpsertPreferenceInput,
} from "../../src/ports/notification-repository.ts";

const ORG = "11111111-1111-1111-1111-111111111111";
const USER = "user-1";
const ACTOR = { actorId: USER, actorRoles: ["tenant-admin"] };

function fakeNotifications(): NotificationRepository & {
  _log: LogDispatchInput[];
  _prefs: PreferenceRecord[];
} {
  let prefs: PreferenceRecord[] = [];
  const log: LogDispatchInput[] = [];
  return {
    _log: log,
    _prefs: prefs,
    async listPreferences() {
      return prefs;
    },
    async listPreferencesAsOperator() {
      return prefs;
    },
    async upsertPreferences(i: UpsertPreferenceInput) {
      prefs = i.preferences;
      (this as { _prefs: PreferenceRecord[] })._prefs = prefs;
    },
    async logDispatch(i) {
      log.push(i);
    },
    async countLog() {
      return log.length;
    },
  };
}

function capturingAudit(): { port: AuditEventPort; events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return { events, port: { emit: async (e) => void events.push(e), query: async () => events } };
}

describe("notifications usecase", () => {
  it("reads + writes the caller's own preferences (audited)", async () => {
    const audit = capturingAudit();
    const deps = { notifications: fakeNotifications(), audit: audit.port };
    assert.equal((await getMyPreferences(ORG, USER, deps)).preferences.length, 0);
    await updateMyPreferences(
      {
        organisationId: ORG,
        userId: USER,
        preferences: [{ channel: "email", category: "security", enabled: true }],
        actor: ACTOR,
      },
      deps
    );
    assert.equal(audit.events[0]?.resource, "notification_preference");
    assert.equal((await getMyPreferences(ORG, USER, deps)).preferences.length, 1);
  });

  it("an enabled channel dispatches + logs; a disabled channel is suppressed", async () => {
    const notifications = fakeNotifications();
    const deps = { notifications, audit: capturingAudit().port };
    await updateMyPreferences(
      {
        organisationId: ORG,
        userId: USER,
        preferences: [
          { channel: "email", category: "security", enabled: true },
          { channel: "webhook", category: "security", enabled: false },
        ],
        actor: ACTOR,
      },
      deps
    );
    const results = await dispatchNotification(
      { organisationId: ORG, userId: USER, category: "security", subject: "hi" },
      deps
    );
    const byChannel = Object.fromEntries(results.map((r) => [r.channel, r.status]));
    assert.equal(byChannel["email"], "sent");
    assert.equal(byChannel["webhook"], "suppressed");
    assert.equal(notifications._log.length, 2);
  });

  it("rejects secret-bearing payload fields", async () => {
    const deps = { notifications: fakeNotifications(), audit: capturingAudit().port };
    await assert.rejects(
      dispatchNotification(
        {
          organisationId: ORG,
          userId: USER,
          category: "security",
          subject: "x",
          payload: { password: "leak" },
        },
        deps
      )
    );
  });

  it("readiness lists local channels as available (never faked, no paid provider)", async () => {
    const deps = { notifications: fakeNotifications(), audit: capturingAudit().port };
    const r = await getNotificationReadiness(deps);
    assert.ok(r.channels.every((c) => c.available));
    assert.ok(r.channels.every((c) => /local/.test(c.transport)));
  });

  it("operator test send uses the local adapter and is audited", async () => {
    const notifications = fakeNotifications();
    const audit = capturingAudit();
    const deps = { notifications, audit: audit.port };
    await updateMyPreferences(
      {
        organisationId: ORG,
        userId: USER,
        preferences: [{ channel: "email", category: "system", enabled: true }],
        actor: ACTOR,
      },
      deps
    );
    const res = await sendTestNotification(
      { organisationId: ORG, userId: USER, category: "system", actor: ACTOR },
      deps
    );
    assert.equal(res.dispatched.find((d) => d.channel === "email")?.status, "sent");
    assert.ok(audit.events.some((e) => e.action === "notification.tested"));
  });
});
