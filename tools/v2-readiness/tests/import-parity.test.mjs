import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractImports, packageNameOf } from "../../architecture/_shared/import-edges.mjs";
import { collectImportMap } from "../src/package-status.mjs";
import { scanRoots } from "../../architecture/validate-source-imports/src/scanner.mjs";

// A single mixed fixture exercising every specifier form the canonical parser must cover.
const MIXED = `
import { a } from "@platform/foo";
export { b } from "@platform/foo/sub";
import type { C } from "@platform/bar";
import D = require("@platform/baz");
const e = await import("@platform/qux");
const f = require("@platform/quux");
type G = import("@platform/corge").Thing;
`;

test("shared parser captures static, export-from, type-only, import-equals, dynamic, require and subpath", () => {
  const { imports } = extractImports(MIXED, "x.ts");
  const pkgs = new Set(
    imports.filter((s) => s.startsWith("@platform/")).map((s) => packageNameOf(s))
  );
  assert.deepEqual([...pkgs].sort(), [
    "@platform/bar",
    "@platform/baz",
    "@platform/corge",
    "@platform/foo",
    "@platform/quux",
    "@platform/qux",
  ]);
});

test("characterization: collectImportMap (v2-readiness) and scanRoots (validate-source-imports) agree on the consumer set", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "import-parity-"));
  const pkgDir = path.join(dir, "packages/consumer");
  fs.mkdirSync(path.join(pkgDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: "@platform/consumer" })
  );
  fs.writeFileSync(path.join(pkgDir, "src/index.ts"), MIXED);

  // v2-readiness view: which @platform packages are imported (by package name)
  const map = collectImportMap(dir, ["packages"]);
  const v2set = new Set(Object.keys(map).map((p) => `@platform/${p}`));

  // validate-source-imports view: specifiers discovered, reduced to package names
  const { files } = scanRoots(["packages"], dir);
  const vsiset = new Set(
    files
      .flatMap((f) => f.imports)
      .filter((s) => s.startsWith("@platform/"))
      .map((s) => packageNameOf(s))
  );

  assert.deepEqual([...v2set].sort(), [...vsiset].sort());
  assert.ok(v2set.has("@platform/foo") && v2set.has("@platform/bar"));
});
