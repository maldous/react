import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyPortableTenantImport,
  buildPortableTenantExport,
  verifyPortableTenantArchive,
  type DataKeyStore,
  type PortableTenantExportEntry,
  type PortableTenantImportApplier,
  type PortableImportProgress,
} from "../../src/usecases/data-portability.ts";
import { PostgresPortableTenantImportApplier } from "../../src/adapters/postgres-portable-tenant-import-applier.ts";

function memorySecretStore(): DataKeyStore {
  const values = new Map<string, string>();
  return {
    put: async (input) => {
      const ref = `secret:${input.name}`;
      values.set(`${input.organisationId}:${ref}`, input.value);
      return { ref };
    },
    resolve: async (organisationId, ref) => values.get(`${organisationId}:${ref}`) ?? null,
  };
}

function applier(failPath?: string): {
  applier: PortableTenantImportApplier;
  applied: string[];
  events: string[];
  progress: PortableImportProgress[];
} {
  const applied: string[] = [];
  const events: string[] = [];
  const progress: PortableImportProgress[] = [];
  return {
    applied,
    events,
    progress,
    applier: {
      beginGroup: async (order) => {
        events.push(`begin:${order}`);
      },
      applyEntry: async (entry: PortableTenantExportEntry) => {
        if (entry.path === failPath) throw new Error(`cannot apply ${entry.path}`);
        applied.push(entry.path);
      },
      commitGroup: async (order) => {
        events.push(`commit:${order}`);
      },
      rollbackGroup: async (order) => {
        events.push(`rollback:${order}`);
      },
      recordProgress: async (p) => {
        progress.push(p);
      },
    },
  };
}

function fakePgPool(options: { failDomainConflict?: boolean } = {}) {
  const calls: string[] = [];
  const client = {
    query: async (text: string) => {
      calls.push(text.trim().replace(/\s+/g, " "));
      if (text.includes("RETURNING id"))
        return { rows: [{ id: "00000000-0000-4000-8000-000000000123" }], rowCount: 1 };
      if (options.failDomainConflict && text.includes("tenant_domains"))
        return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    },
    release: () => {
      calls.push("release");
    },
  };
  return {
    calls,
    pool: {
      connect: async () => client,
      query: async (text: string) => {
        calls.push(text.trim().replace(/\s+/g, " "));
        return { rows: [], rowCount: 1 };
      },
    },
  };
}

describe("data portability", () => {
  it("builds encrypted tar.gz archive with root manifest, ordered entries and digests", async () => {
    const secretStore = memorySecretStore();
    const out = await buildPortableTenantExport(
      {
        tenantId: "tenant-1",
        sourceCommit: "deadbeef",
        entries: [
          { path: "domain/b.json", content: { b: 2 }, order: 2 },
          { path: "identity/a.json", content: { a: 1 }, order: 1 },
        ],
        exportedAt: "2026-01-01T00:00:00.000Z",
      },
      { secretStore, actorId: "u1" }
    );

    assert.equal(out.manifest.entries[0]?.path, "identity/a.json");
    assert.equal(out.manifest.entries[1]?.path, "domain/b.json");
    assert.equal(out.manifest.counts.entries, 2);
    assert.ok(out.digest.length > 0);
    assert.equal(out.archive.includes(Buffer.from("identity/a.json")), false);
    assert.equal(out.archive.includes(Buffer.from('"a":1')), false);

    const verified = await verifyPortableTenantArchive(out.archive, {
      tenantId: "tenant-1",
      secretStore,
    });
    assert.equal(verified.manifest.tenantId, "tenant-1");
    assert.equal(verified.entries[0]?.sha256, out.manifest.entries[0]?.sha256);
    assert.deepEqual(
      verified.entries.map((e) => e.path),
      ["identity/a.json", "domain/b.json"]
    );
  });

  it("rejects tampered encrypted archives before import", async () => {
    const secretStore = memorySecretStore();
    const out = await buildPortableTenantExport(
      {
        tenantId: "tenant-1",
        sourceCommit: "deadbeef",
        entries: [{ path: "identity/a.json", content: { a: 1 }, order: 1 }],
      },
      { secretStore, actorId: "u1" }
    );
    const envelope = JSON.parse(out.archive.toString("utf8")) as { ciphertext: string };
    envelope.ciphertext =
      (envelope.ciphertext[0] === "A" ? "B" : "A") + envelope.ciphertext.slice(1);
    const tampered = Buffer.from(JSON.stringify(envelope), "utf8");
    await assert.rejects(() =>
      verifyPortableTenantArchive(tampered, { tenantId: "tenant-1", secretStore })
    );
  });

  it("applies import groups transactionally and records resumable progress", async () => {
    const secretStore = memorySecretStore();
    const out = await buildPortableTenantExport(
      {
        tenantId: "tenant-1",
        sourceCommit: "deadbeef",
        entries: [
          { path: "identity/users.json", content: [{ id: "u1" }], order: 1 },
          { path: "config/settings.json", content: { theme: "plain" }, order: 2 },
          { path: "audit/events.json", content: [], order: 3 },
        ],
      },
      { secretStore, actorId: "u1" }
    );
    const first = applier("config/settings.json");
    const failed = await applyPortableTenantImport(out.archive, {
      tenantId: "tenant-1",
      secretStore,
      applier: first.applier,
    });
    assert.deepEqual(failed.completedOrders, [1]);
    assert.equal(failed.failedOrder, 2);
    assert.deepEqual(first.events, ["begin:1", "commit:1", "begin:2", "rollback:2"]);

    const second = applier();
    const completed = await applyPortableTenantImport(out.archive, {
      tenantId: "tenant-1",
      secretStore,
      applier: second.applier,
      resume: failed,
    });
    assert.deepEqual(completed.completedOrders, [1, 2, 3]);
    assert.deepEqual(second.applied, ["config/settings.json", "audit/events.json"]);
  });

  it("postgres import applier writes member/domain/history groups and durable progress", async () => {
    const secretStore = memorySecretStore();
    const out = await buildPortableTenantExport(
      {
        tenantId: "11111111-1111-4111-8111-111111111111",
        sourceCommit: "deadbeef",
        entries: [
          {
            path: "identity/members.json",
            content: {
              members: [
                { email: "a@example.com", displayName: "A", role: "viewer", status: "active" },
              ],
              pendingInvitations: [],
            },
            order: 1,
          },
          {
            path: "config/domains.json",
            content: [{ domain: "app.example.com", status: "verified", authClient: "active" }],
            order: 2,
          },
          {
            path: "audit/history.json",
            content: {
              entries: [
                {
                  id: "audit-row-1",
                  source: "audit",
                  type: "member.invited",
                  title: "member.invited organisation:members",
                  occurredAt: "2026-01-01T00:00:00.000Z",
                  actorId: "actor-1",
                },
              ],
            },
            order: 4,
          },
        ],
      },
      { secretStore, actorId: "u1" }
    );
    const fake = fakePgPool();
    const progress = await applyPortableTenantImport(out.archive, {
      tenantId: "11111111-1111-4111-8111-111111111111",
      secretStore,
      applier: new PostgresPortableTenantImportApplier(
        fake.pool as never,
        "11111111-1111-4111-8111-111111111111",
        out.digest
      ),
    });
    assert.deepEqual(progress.completedOrders, [1, 2, 4]);
    assert.ok(fake.calls.some((c) => c.includes("INSERT INTO public.users")));
    assert.ok(fake.calls.some((c) => c.includes("INSERT INTO public.memberships")));
    assert.ok(fake.calls.some((c) => c.includes("INSERT INTO public.tenant_domains")));
    assert.ok(fake.calls.some((c) => c.includes("INSERT INTO public.audit_events")));
    assert.ok(fake.calls.some((c) => c.includes("INSERT INTO public.portable_import_progress")));
  });

  it("postgres import applier rolls back and records progress on cross-tenant domain conflicts", async () => {
    const secretStore = memorySecretStore();
    const out = await buildPortableTenantExport(
      {
        tenantId: "11111111-1111-4111-8111-111111111111",
        sourceCommit: "deadbeef",
        entries: [
          {
            path: "config/domains.json",
            content: [{ domain: "taken.example.com", status: "verified" }],
            order: 2,
          },
        ],
      },
      { secretStore, actorId: "u1" }
    );
    const fake = fakePgPool({ failDomainConflict: true });
    const progress = await applyPortableTenantImport(out.archive, {
      tenantId: "11111111-1111-4111-8111-111111111111",
      secretStore,
      applier: new PostgresPortableTenantImportApplier(
        fake.pool as never,
        "11111111-1111-4111-8111-111111111111",
        out.digest
      ),
    });
    assert.deepEqual(progress.completedOrders, []);
    assert.equal(progress.failedOrder, 2);
    assert.ok(fake.calls.some((c) => c === "ROLLBACK"));
    assert.ok(fake.calls.some((c) => c.includes("INSERT INTO public.portable_import_progress")));
  });
});
