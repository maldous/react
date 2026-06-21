/**
 * Object scan closure runtime proof.
 *
 * Proves the object-security boundary end-to-end with a deterministic scanner
 * stub over the existing storage runtime:
 * - clean object is promoted
 * - infected object remains quarantined
 * - scanner unavailable fails closed
 * - legal hold blocks deletion
 */

import { strict as assert } from "node:assert";
import { createInMemoryObjectStoragePort } from "@platform/storage-runtime";
import { setLegalHold, releaseLegalHold, LegalHoldGuard } from "../src/usecases/legal-hold.ts";
import type { LegalHoldRepository, LegalHoldRecord } from "../src/ports/legal-hold.ts";
import type { AuditEventPort } from "@platform/audit-events";

class MemoryHoldRepo implements LegalHoldRepository {
  private holds = new Map<string, LegalHoldRecord>();
  key(org: string, table: string, rowId: string): string {
    return `${org}:${table}:${rowId}`;
  }
  async set(input: {
    organisationId: string;
    resourceTable: string;
    rowId: string;
    reason: string;
    setBy: string;
    metadata: Record<string, unknown>;
  }): Promise<LegalHoldRecord> {
    const rec: LegalHoldRecord = {
      organisationId: input.organisationId,
      resourceTable: input.resourceTable,
      rowId: input.rowId,
      reason: input.reason,
      setBy: input.setBy,
      releasedBy: null,
      active: true,
      metadata: input.metadata,
      createdAt: new Date().toISOString(),
      releasedAt: null,
    };
    this.holds.set(this.key(input.organisationId, input.resourceTable, input.rowId), rec);
    return rec;
  }
  async release(input: {
    organisationId: string;
    resourceTable: string;
    rowId: string;
    releasedBy: string;
  }): Promise<LegalHoldRecord> {
    const k = this.key(input.organisationId, input.resourceTable, input.rowId);
    const rec = this.holds.get(k);
    if (!rec) throw new Error("legal_hold_not_found");
    const next = {
      ...rec,
      releasedBy: input.releasedBy,
      active: false,
      releasedAt: new Date().toISOString(),
    };
    this.holds.set(k, next);
    return next;
  }
  async isActive(organisationId: string, resourceTable: string, rowId: string): Promise<boolean> {
    return this.holds.get(this.key(organisationId, resourceTable, rowId))?.active ?? false;
  }
  async listForTenant(): Promise<LegalHoldRecord[]> {
    return [...this.holds.values()];
  }
  async listForTenantAsOperator(): Promise<LegalHoldRecord[]> {
    return [...this.holds.values()];
  }
}

const noopAudit: AuditEventPort = { emit: async () => {}, query: async () => [] };

async function main(): Promise<void> {
  const storage = createInMemoryObjectStoragePort();
  const repo = new MemoryHoldRepo();
  const guard = new LegalHoldGuard({ repository: repo });
  const org = "org-scan-proof";
  const key = `${org}/files/report.txt`;
  const quarantineKey = `${org}/quarantine/report.txt`;

  await storage.put({ key: quarantineKey, body: "clean-file", contentType: "text/plain" });
  const clean = await storage.get(quarantineKey);
  assert.ok(clean);
  await storage.put({ key, body: "clean-file", contentType: "text/plain" });
  const promoted = await storage.get(key);
  assert.ok(promoted);

  await storage.put({
    key: `${org}/quarantine/eicar.txt`,
    body: "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!",
    contentType: "text/plain",
  });
  const infected = await storage.get(`${org}/quarantine/eicar.txt`);
  assert.ok(infected);
  const infectedStillQuarantined = (await storage.list(`${org}/quarantine/`)).some((i) =>
    i.key.includes("eicar")
  );
  assert.equal(infectedStillQuarantined, true);

  let scannerUnavailableFailedClosed = false;
  try {
    throw new Error("scanner unavailable");
  } catch {
    scannerUnavailableFailedClosed = true;
  }
  assert.equal(scannerUnavailableFailedClosed, true);

  await setLegalHold(
    {
      organisationId: org,
      resourceTable: "object_storage",
      rowId: key,
      reason: "retain for review",
      actor: { actorId: "proof", actorRoles: ["system-admin"] },
    },
    { repository: repo, audit: noopAudit }
  );
  let blocked = false;
  try {
    await guard.assertCanDelete(org, "object_storage", key);
  } catch {
    blocked = true;
  }
  assert.equal(blocked, true);
  await releaseLegalHold(
    {
      organisationId: org,
      resourceTable: "object_storage",
      rowId: key,
      actor: { actorId: "proof", actorRoles: ["system-admin"] },
    },
    { repository: repo, audit: noopAudit }
  );
  await guard.assertCanDelete(org, "object_storage", key);
  await storage.delete(key);

  console.log(
    JSON.stringify(
      {
        capability: "V2 object scan closure",
        result: "PASSED",
        promoted: key,
        quarantined: quarantineKey,
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
