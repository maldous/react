import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { packageRemovalStatus, collectImportMap } from "../src/package-status.mjs";

const PKG = "worker-runtime";

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pkgstat-"));
  fs.mkdirSync(path.join(dir, "packages"), { recursive: true });
  fs.mkdirSync(path.join(dir, "apps/platform-api"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs/architecture"), { recursive: true });
  // baseline cleanup-ref files that do NOT mention the package
  fs.writeFileSync(path.join(dir, "apps/platform-api/loader.mjs"), "export const x = 1;\n");
  fs.writeFileSync(
    path.join(dir, "packages/tsconfig.packages.json"),
    JSON.stringify({ references: [] })
  );
  fs.writeFileSync(
    path.join(dir, "docs/architecture/import-boundary-rules.json"),
    JSON.stringify({ rules: [] })
  );
  return dir;
}
const addPkgDir = (d) => {
  fs.mkdirSync(path.join(d, "packages", PKG), { recursive: true });
  fs.writeFileSync(
    path.join(d, "packages", PKG, "package.json"),
    JSON.stringify({ name: `@platform/${PKG}` })
  );
};
const addEvidence = (d, valid = true) => {
  const ev = path.join(d, "docs/evidence/lifecycle/removal");
  fs.mkdirSync(ev, { recursive: true });
  fs.writeFileSync(
    path.join(ev, `${PKG}.md`),
    valid ? "Consumer scan: clean. Package removed.\n" : "draft\n"
  );
};
const status = (d) => packageRemovalStatus(d, PKG, { importMap: collectImportMap(d) });

test("1. package exists (path-map entry permanent) -> blocker", () => {
  const d = mkRepo();
  addPkgDir(d);
  addEvidence(d); // even with evidence, presence blocks
  const s = status(d);
  assert.equal(s.present, true);
  assert.equal(s.blocker, true);
});

test("2. package absent + removal evidence valid -> clean", () => {
  const d = mkRepo();
  addEvidence(d, true);
  const s = status(d);
  assert.equal(s.present, false);
  assert.equal(s.removalEvidenceOk, true);
  assert.equal(s.blocker, false);
});

test("3. package absent but loader alias remains -> blocker", () => {
  const d = mkRepo();
  addEvidence(d, true);
  fs.writeFileSync(path.join(d, "apps/platform-api/loader.mjs"), `import "@platform/${PKG}";\n`);
  const s = status(d);
  assert.equal(s.present, true);
  assert.ok(s.reasons.includes("loaderAlias"));
  assert.equal(s.blocker, true);
});

test("4. package absent but tsconfig reference remains -> blocker", () => {
  const d = mkRepo();
  addEvidence(d, true);
  fs.writeFileSync(
    path.join(d, "packages/tsconfig.packages.json"),
    JSON.stringify({ references: [{ path: `./${PKG}` }] })
  );
  const s = status(d);
  assert.equal(s.present, true);
  assert.ok(s.reasons.includes("tsconfigRef"));
  assert.equal(s.blocker, true);
});

test("5. package absent without removal evidence -> blocker", () => {
  const d = mkRepo();
  const s = status(d);
  assert.equal(s.present, false);
  assert.equal(s.removalEvidenceOk, false);
  assert.equal(s.blocker, true);
  assert.ok(s.reasons.includes("removal-evidence-missing-or-invalid"));
});
