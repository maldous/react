import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  assertTenantResidencyPlacement,
  setTenantResidency,
} from "../../src/usecases/data-residency.ts";
import { createInMemoryAuditEventPort } from "@platform/audit-events";

class Repo {
  tag: string | null = null;
  async getResidencyTag(): Promise<string | null> {
    return this.tag;
  }
  async setResidencyTag(_organisationId: string, residencyTag: string): Promise<void> {
    this.tag = residencyTag;
  }
}

describe("data residency", () => {
  it("sets residency tag and rejects non-home placement fail-closed", async () => {
    const repo = new Repo();
    const audit = createInMemoryAuditEventPort();
    const res = await setTenantResidency(
      {
        organisationId: "00000000-0000-0000-0000-000000000001",
        residencyTag: "au-syd",
        actor: { actorId: "op-1", actorRoles: ["platform.data.admin"] },
      },
      { repository: repo, audit }
    );
    assert.equal(res.kind, "ok");
    assert.equal(await repo.getResidencyTag("x"), "au-syd");
    await assert.rejects(
      () =>
        assertTenantResidencyPlacement(
          {
            organisationId: "00000000-0000-0000-0000-000000000001",
            targetRegion: "us-east-1",
            actorId: "op-1",
          },
          { repository: repo }
        ),
      /residency/i
    );
  });
});
