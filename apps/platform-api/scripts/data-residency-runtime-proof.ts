import { strict as assert } from "node:assert";
import { createInMemoryAuditEventPort } from "@platform/audit-events";
import {
  assertTenantResidencyPlacement,
  setTenantResidency,
} from "../src/usecases/data-residency.ts";

async function main(): Promise<void> {
  const repo = {
    tag: null as string | null,
    async getResidencyTag() {
      return this.tag;
    },
    async setResidencyTag(_organisationId: string, residencyTag: string) {
      this.tag = residencyTag;
    },
  };
  const audit = createInMemoryAuditEventPort();
  const res = await setTenantResidency(
    {
      organisationId: "00000000-0000-0000-0000-000000000002",
      residencyTag: "au-syd",
      actor: { actorId: "op-1", actorRoles: ["platform.data.admin"] },
    },
    { repository: repo, audit }
  );
  assert.equal(res.kind, "ok");
  await assert.rejects(() =>
    assertTenantResidencyPlacement(
      {
        organisationId: "00000000-0000-0000-0000-000000000002",
        targetRegion: "us-east-1",
        actorId: "op-1",
      },
      { repository: repo }
    )
  );
  console.log(JSON.stringify({ capability: "V1C-12d Data residency", result: "PASSED" }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
