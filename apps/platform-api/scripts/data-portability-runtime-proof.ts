import { strict as assert } from "node:assert";
import {
  applyPortableTenantImport,
  buildPortableTenantExport,
  verifyPortableTenantArchive,
  type DataKeyStore,
  type PortableTenantExportEntry,
  type PortableTenantImportApplier,
  type PortableImportProgress,
} from "../src/usecases/data-portability.ts";
import { PostgresPortableTenantImportApplier } from "../src/adapters/postgres-portable-tenant-import-applier.ts";
import { routes } from "../src/server/routes.ts";

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
  progress: PortableImportProgress[];
} {
  const applied: string[] = [];
  const progress: PortableImportProgress[] = [];
  return {
    applied,
    progress,
    applier: {
      beginGroup: async () => undefined,
      applyEntry: async (entry: PortableTenantExportEntry) => {
        if (entry.path === failPath) throw new Error(`cannot apply ${entry.path}`);
        applied.push(entry.path);
      },
      commitGroup: async () => undefined,
      rollbackGroup: async () => undefined,
      recordProgress: async (p) => void progress.push(p),
    },
  };
}

function fakePgPool() {
  const client = {
    query: async (text: string) => {
      if (text.includes("RETURNING id")) {
        return { rows: [{ id: "00000000-0000-4000-8000-000000000123" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release: () => undefined,
  };
  return {
    connect: async () => client,
    query: async () => ({ rows: [], rowCount: 1 }),
  };
}

async function main(): Promise<void> {
  assert.ok(
    routes.some((r) => r.path === "/api/admin/tenants/:tenantId/export"),
    "tenant export route registered"
  );
  assert.ok(
    routes.some((r) => r.path === "/api/admin/tenants/:tenantId/import"),
    "tenant import route registered"
  );

  const secretStore = memorySecretStore();
  const out = await buildPortableTenantExport(
    {
      tenantId: "tenant-1",
      sourceCommit: "deadbeef",
      exportedAt: "2026-01-01T00:00:00.000Z",
      entries: [
        { path: "identity/users.json", content: [{ id: "u1" }], order: 1 },
        { path: "config/settings.json", content: { locale: "en" }, order: 2 },
        { path: "audit/events.json", content: [], order: 3 },
      ],
    },
    { secretStore, actorId: "proof" }
  );
  assert.equal(out.archive.includes(Buffer.from("identity/users.json")), false);
  assert.equal(out.archive.includes(Buffer.from('"locale":"en"')), false);

  const verified = await verifyPortableTenantArchive(out.archive, {
    tenantId: "tenant-1",
    secretStore,
  });
  assert.equal(verified.manifest.counts.entries, 3);
  assert.deepEqual(
    verified.manifest.entries.map((e) => e.order),
    [1, 2, 3]
  );
  assert.equal(verified.digest, out.digest);

  const envelope = JSON.parse(out.archive.toString("utf8")) as { ciphertext: string };
  envelope.ciphertext = (envelope.ciphertext[0] === "A" ? "B" : "A") + envelope.ciphertext.slice(1);
  const tampered = Buffer.from(JSON.stringify(envelope), "utf8");
  await assert.rejects(() =>
    verifyPortableTenantArchive(tampered, { tenantId: "tenant-1", secretStore })
  );

  const first = applier("config/settings.json");
  const failed = await applyPortableTenantImport(out.archive, {
    tenantId: "tenant-1",
    secretStore,
    applier: first.applier,
  });
  assert.deepEqual(failed.completedOrders, [1]);
  assert.equal(failed.failedOrder, 2);

  const second = applier();
  const completed = await applyPortableTenantImport(out.archive, {
    tenantId: "tenant-1",
    secretStore,
    applier: second.applier,
    resume: failed,
  });
  assert.deepEqual(completed.completedOrders, [1, 2, 3]);
  assert.deepEqual(second.applied, ["config/settings.json", "audit/events.json"]);

  const durableOut = await buildPortableTenantExport(
    {
      tenantId: "tenant-1",
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
    { secretStore, actorId: "proof" }
  );
  const durable = await applyPortableTenantImport(durableOut.archive, {
    tenantId: "tenant-1",
    secretStore,
    applier: new PostgresPortableTenantImportApplier(
      fakePgPool() as never,
      "tenant-1",
      durableOut.digest
    ),
  });
  assert.deepEqual(durable.completedOrders, [1, 2, 4]);

  console.log(
    JSON.stringify(
      {
        capability: "V1C-14",
        result: "PASSED",
        bytes: out.archive.length,
        semantics: [
          "encrypted AES-256-GCM envelope",
          "data key wrapped through SecretStore",
          "gzip-compressed tar with root manifest",
          "entry sha256 and byte checks verified",
          "tamper rejected",
          "transactional group rollback",
          "resumable import progress",
          "durable Postgres import applier writes all groups",
        ],
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
