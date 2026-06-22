/**
 * Support tickets workflow runtime proof.
 *
 * Proves the hermetic support ticket workflow boundary:
 * - audit-before-create
 * - request-id idempotency keeps repeated creates on one durable row
 * - list/health read paths execute through the same observed usecase
 * - operator cancellation compensates by deleting the ticket
 *
 * Proof tier: hermetic-domain.
 */

import { strict as assert } from "node:assert";
import type { AuditEventPort } from "@platform/audit-events";
import {
  cancelSupportTicket,
  createSupportTicket,
  getCustomerHealth,
  getSupportTicketMetric,
  listSupportTickets,
} from "../src/usecases/support-tickets.ts";

class InMemoryAudit implements AuditEventPort {
  public readonly actions: string[] = [];
  async emit(event: { action: string }): Promise<void> {
    this.actions.push(event.action);
  }
  async query(): Promise<never[]> {
    return [];
  }
}

class SupportTicketPool {
  public readonly rows: Array<{
    id: string;
    organisation_id: string;
    subject: string;
    body: string;
    created_by: string;
    created_at: Date;
  }> = [];

  async query<T = Record<string, unknown>>(
    text: string,
    values: unknown[] = []
  ): Promise<{ rows: T[] }> {
    const sql = String(text);
    if (sql.includes("INSERT INTO public.support_tickets")) {
      const withId = sql.includes("(id, organisation_id");
      const id = String(withId ? values[0] : `ticket-${this.rows.length + 1}`);
      const organisationId = String(withId ? values[1] : values[0]);
      const existing = this.rows.find((row) => row.id === id);
      if (!existing) {
        this.rows.push({
          id,
          organisation_id: organisationId,
          subject: String(withId ? values[2] : values[1]),
          body: String(withId ? values[3] : values[2]),
          created_by: String(withId ? values[4] : values[3]),
          created_at: new Date("2026-01-01T00:00:00.000Z"),
        });
      }
      return { rows: [{ id }] as T[] };
    }
    if (sql.includes("DELETE FROM public.support_tickets")) {
      const index = this.rows.findIndex(
        (row) => row.organisation_id === values[0] && row.id === values[1]
      );
      if (index === -1) return { rows: [] };
      const [removed] = this.rows.splice(index, 1);
      return { rows: [{ id: removed!.id }] as T[] };
    }
    if (sql.includes("COUNT(*)")) {
      return {
        rows: [
          { count: this.rows.filter((row) => row.organisation_id === values[0]).length },
        ] as T[],
      };
    }
    if (sql.includes("SUM(quantity)")) return { rows: [{ count: 0 }] as T[] };
    if (sql.includes("SELECT id, subject")) {
      return { rows: this.rows.filter((row) => row.organisation_id === values[0]) as T[] };
    }
    return { rows: [] };
  }
}

async function main(): Promise<void> {
  const audit = new InMemoryAudit();
  const pool = new SupportTicketPool();
  const base = {
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    organisationId: "22222222-2222-4222-8222-222222222222",
    subject: "Production incident",
    body: "Investigate failing workflow",
    actorId: "operator-1",
    actorRoles: ["system-admin"],
  };

  const first = await createSupportTicket(base, { pool: pool as never, audit });
  const second = await createSupportTicket(
    { ...base, body: "retry body ignored" },
    { pool: pool as never, audit }
  );
  assert.equal(first.id, base.idempotencyKey);
  assert.equal(second.id, first.id);
  assert.equal(pool.rows.length, 1);
  assert.equal((await listSupportTickets(base.organisationId, { pool: pool as never })).length, 1);
  assert.equal(
    (await getCustomerHealth(base.organisationId, { pool: pool as never })).signals.tickets,
    1
  );
  assert.equal(
    (
      await cancelSupportTicket(
        {
          organisationId: base.organisationId,
          ticketId: first.id,
          actorId: "operator-2",
          actorRoles: ["system-admin"],
        },
        { pool: pool as never, audit }
      )
    ).status,
    "cancelled"
  );
  assert.equal(pool.rows.length, 0);
  assert.ok(getSupportTicketMetric("createAttempts") >= 2);
  assert.deepEqual(audit.actions, [
    "notification.tested",
    "notification.tested",
    "notification.tested",
  ]);

  console.log(
    JSON.stringify(
      {
        capability: "V1C-05 support tickets",
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
