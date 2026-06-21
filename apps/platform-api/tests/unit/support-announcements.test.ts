import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSupportAnnouncement,
  listSupportAnnouncements,
} from "../../src/usecases/support-announcements.ts";

describe("support announcements usecase", () => {
  it("creates and lists tenant announcements", async () => {
    const rows: Array<{
      id: string;
      subject: string;
      message: string;
      created_by: string;
      created_at: Date;
    }> = [];
    const deps = {
      pool: {
        async query(text: string, values?: unknown[]) {
          if (String(text).startsWith("INSERT INTO public.support_announcements")) {
            const row = {
              id: "ann-1",
              subject: String(values?.[1]),
              message: String(values?.[2]),
              created_by: String(values?.[3]),
              created_at: new Date(),
            };
            rows.push(row);
            return { rows: [{ id: row.id }] };
          }
          return { rows };
        },
      },
      audit: { emit: async () => undefined },
    };

    const created = await createSupportAnnouncement(
      {
        organisationId: "org-1",
        subject: "Hello",
        message: "World",
        actorId: "user-1",
        actorRoles: ["system-admin"],
      },
      deps
    );
    assert.equal(created.id, "ann-1");

    const listed = await listSupportAnnouncements("org-1", deps);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.subject, "Hello");
  });
});
