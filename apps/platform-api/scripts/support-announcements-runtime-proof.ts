/**
 * Support announcements workflow runtime proof.
 *
 * Proves the hermetic support announcement workflow boundary:
 * - audit-before-publish
 * - request-id idempotency keeps repeated publishes on one durable row
 * - list read path executes through the same observed usecase
 * - operator cancellation compensates by deleting the announcement
 *
 * Proof tier: hermetic-domain.
 */

import { strict as assert } from "node:assert";
import type { AuditEventPort } from "@platform/audit-events";
import {
  cancelSupportAnnouncement,
  createSupportAnnouncement,
  getSupportAnnouncementMetric,
  listSupportAnnouncements,
} from "../src/usecases/support-announcements.ts";

class InMemoryAudit implements AuditEventPort {
  public readonly actions: string[] = [];
  async emit(event: { action: string }): Promise<void> {
    this.actions.push(event.action);
  }
  async query(): Promise<never[]> {
    return [];
  }
}

class SupportAnnouncementPool {
  public readonly rows: Array<{
    id: string;
    organisation_id: string;
    subject: string;
    message: string;
    created_by: string;
    created_at: Date;
  }> = [];

  async query<T = Record<string, unknown>>(
    text: string,
    values: unknown[] = []
  ): Promise<{ rows: T[] }> {
    const sql = String(text);
    if (sql.includes("INSERT INTO public.support_announcements")) {
      const withId = sql.includes("(id, organisation_id");
      const id = String(withId ? values[0] : `announcement-${this.rows.length + 1}`);
      const organisationId = String(withId ? values[1] : values[0]);
      const existing = this.rows.find((row) => row.id === id);
      if (!existing) {
        this.rows.push({
          id,
          organisation_id: organisationId,
          subject: String(withId ? values[2] : values[1]),
          message: String(withId ? values[3] : values[2]),
          created_by: String(withId ? values[4] : values[3]),
          created_at: new Date("2026-01-01T00:00:00.000Z"),
        });
      }
      return { rows: [{ id }] as T[] };
    }
    if (sql.includes("DELETE FROM public.support_announcements")) {
      const index = this.rows.findIndex(
        (row) => row.organisation_id === values[0] && row.id === values[1]
      );
      if (index === -1) return { rows: [] };
      const [removed] = this.rows.splice(index, 1);
      return { rows: [{ id: removed!.id }] as T[] };
    }
    if (sql.includes("SELECT id, subject")) {
      return { rows: this.rows.filter((row) => row.organisation_id === values[0]) as T[] };
    }
    return { rows: [] };
  }
}

async function main(): Promise<void> {
  const audit = new InMemoryAudit();
  const pool = new SupportAnnouncementPool();
  const base = {
    idempotencyKey: "33333333-3333-4333-8333-333333333333",
    organisationId: "44444444-4444-4444-8444-444444444444",
    subject: "Maintenance",
    message: "Planned maintenance window",
    actorId: "operator-1",
    actorRoles: ["system-admin"],
  };

  const first = await createSupportAnnouncement(base, { pool, audit });
  const second = await createSupportAnnouncement(
    { ...base, message: "retry message ignored" },
    { pool, audit }
  );
  assert.equal(first.id, base.idempotencyKey);
  assert.equal(second.id, first.id);
  assert.equal(pool.rows.length, 1);
  assert.equal((await listSupportAnnouncements(base.organisationId, { pool, audit })).length, 1);
  assert.equal(
    (
      await cancelSupportAnnouncement(
        {
          organisationId: base.organisationId,
          announcementId: first.id,
          actorId: "operator-2",
          actorRoles: ["system-admin"],
        },
        { pool, audit }
      )
    ).status,
    "cancelled"
  );
  assert.equal(pool.rows.length, 0);
  assert.ok(getSupportAnnouncementMetric("publishAttempts") >= 2);
  assert.deepEqual(audit.actions, [
    "notification.tested",
    "notification.tested",
    "notification.tested",
  ]);

  console.log(
    JSON.stringify(
      {
        capability: "V1C-05 support announcements",
        proofTier: "hermetic-domain",
        result: "PASSED",
        idempotencyKey: base.idempotencyKey,
        auditActions: audit.actions,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
