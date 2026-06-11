import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  referencedAdrNumbers,
  findUnresolvedAdrRefs,
  adrNumbersOnDisk,
  validate,
} from "../src/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");

describe("referencedAdrNumbers", () => {
  it("extracts ADR-NNNN and ignores ADR-ACT-NNNN", () => {
    const nums = referencedAdrNumbers("see ADR-0036, ADR-0037 and ADR-ACT-0204; also ADR-0013");
    assert.deepEqual(
      [...nums].sort((a, b) => a - b),
      [13, 36, 37]
    );
  });
});

describe("findUnresolvedAdrRefs", () => {
  it("flags references with no file on disk", () => {
    const onDisk = new Set([13, 36]);
    assert.deepEqual(findUnresolvedAdrRefs("ADR-0013 ADR-0036 ADR-9999", onDisk), [9999]);
  });
  it("passes when every reference resolves", () => {
    assert.deepEqual(findUnresolvedAdrRefs("ADR-0013 ADR-0036", new Set([13, 36])), []);
  });
});

describe("validate (real repo)", () => {
  it("every ACTION-REGISTER ADR reference resolves to a file", () => {
    const result = validate(REPO_ROOT);
    assert.equal(result.ok, true, `governance drift:\n${result.problems.join("\n")}`);
  });

  it("the ADR codemap is consistent with the ADR files on disk", () => {
    // adrNumbersOnDisk must include the recent control-plane ADRs.
    const onDisk = adrNumbersOnDisk(path.join(REPO_ROOT, "docs", "adr"));
    assert.ok(onDisk.has(36), "ADR-0036 file missing");
    assert.ok(onDisk.has(37), "ADR-0037 file missing");
  });
});
