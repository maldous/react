import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPortableTenantExport,
  verifyPortableTenantArchive,
} from "../../src/usecases/data-portability.ts";

describe("data portability", () => {
  it("builds an encrypted-ish gzipped manifest archive with ordered entries and digests", () => {
    const out = buildPortableTenantExport({
      tenantId: "tenant-1",
      sourceCommit: "deadbeef",
      entries: [
        { path: "b.json", content: { b: 2 }, order: 2 },
        { path: "a.json", content: { a: 1 }, order: 1 },
      ],
      exportedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(out.manifest.entries[0]?.path, "a.json");
    assert.equal(out.manifest.entries[1]?.path, "b.json");
    assert.equal(out.manifest.counts.entries, 2);
    assert.ok(out.digest.length > 0);
    assert.equal(verifyPortableTenantArchive(out.archive).tenantId, "tenant-1");
  });
});
