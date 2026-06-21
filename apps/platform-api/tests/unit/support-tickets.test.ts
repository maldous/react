import assert from "node:assert/strict";
import test from "node:test";
import { createSupportTicket, getCustomerHealth } from "../../src/usecases/support-tickets.ts";

type DbRow = Record<string, unknown>;

test("support tickets and customer health", async () => {
  const queries: string[] = [];
  const pool = {
    query: async (text: string) => {
      queries.push(text);
      if (String(text).includes("RETURNING id")) return { rows: [{ id: "ticket-1" }] };
      if (String(text).includes("COUNT(*)")) return { rows: [{ count: 2 }] };
      if (String(text).includes("SUM(quantity)")) return { rows: [{ count: 1500 }] };
      return { rows: [] };
    },
  } as { query: (text: string) => Promise<{ rows: DbRow[] }> };
  const audit = { emit: async () => undefined };
  const ticket = await createSupportTicket(
    {
      organisationId: "org-1",
      subject: "Issue",
      body: "Body",
      actorId: "u1",
      actorRoles: ["system-admin"],
    },
    { pool, audit }
  );
  const health = await getCustomerHealth("org-1", { pool });
  assert.equal(ticket.id, "ticket-1");
  assert.equal(health.signals.tickets, 2);
  assert.equal(health.signals.usage, 1500);
});
