import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  packageRemovalStatus,
  collectImportMap,
  validateRemovalEvidence,
} from "../src/package-status.mjs";

const PKG = "worker-runtime";

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pkgstat-"));
  fs.mkdirSync(path.join(dir, "packages"), { recursive: true });
  fs.mkdirSync(path.join(dir, "apps/platform-api/src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs/architecture"), { recursive: true });
  fs.writeFileSync(path.join(dir, "apps/platform-api/loader.mjs"), "export const x = 1;\n");
  fs.writeFileSync(
    path.join(dir, "packages/tsconfig.packages.json"),
    JSON.stringify({ references: [] })
  );
  fs.writeFileSync(
    path.join(dir, "docs/architecture/import-boundary-rules.json"),
    JSON.stringify({ rules: [] })
  );
  fs.writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify({ packages: {} }));
  return dir;
}
const addPkgDir = (d) => {
  fs.mkdirSync(path.join(d, "packages", PKG), { recursive: true });
  fs.writeFileSync(
    path.join(d, "packages", PKG, "package.json"),
    JSON.stringify({ name: `@platform/${PKG}` })
  );
};
const writeSrc = (d, rel, body) => {
  fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
  fs.writeFileSync(path.join(d, rel), body);
};
const addValidEvidence = (d) => {
  const dir = path.join(d, `docs/evidence/lifecycle/removal/${PKG}`);
  fs.mkdirSync(dir, { recursive: true });
  const scan = { status: "clean", count: 0, details: "none" };
  fs.writeFileSync(
    path.join(dir, "removal-evidence.json"),
    JSON.stringify({
      schemaVersion: 1,
      package: PKG,
      removedAt: "2026-06-19",
      sourceCommit: "aaaa111",
      removalCommit: "bbbb222",
      replacement: "USF event-bus",
      decisionRefs: ["ADR-ACT-0289"],
      commandsRun: ["orchestrator all --strict"],
      consumerScan: scan,
      workspaceDependencyScan: scan,
      loaderAliasScan: scan,
      tsconfigReferenceScan: scan,
      boundaryRuleScan: scan,
      lockfileScan: scan,
      inventoryScan: scan,
      tests: scan,
      makeCheckResult: "green",
      orchestratorResult: "exit 0",
    })
  );
};
const status = (d) => packageRemovalStatus(d, PKG, { importMap: collectImportMap(d) });

// The 11 required scanner scenarios — expectations are EXPLICIT test data, not derived from the
// function under test (§4).
test("1. exact package import -> blocker", () => {
  const d = mkRepo();
  addValidEvidence(d);
  writeSrc(d, "apps/platform-api/src/x.ts", `import { W } from "@platform/${PKG}";\n`);
  const s = status(d);
  assert.ok(s.signals.sourceImport);
  assert.equal(s.blocker, true);
});

test("2. subpath import (@platform/pkg/sub) -> blocker", () => {
  const d = mkRepo();
  addValidEvidence(d);
  writeSrc(d, "apps/platform-api/src/x.ts", `import { W } from "@platform/${PKG}/dispatch";\n`);
  const s = status(d);
  assert.ok(s.signals.sourceImport, "subpath import must be detected");
  assert.equal(s.blocker, true);
});

test("3. dynamic import -> blocker", () => {
  const d = mkRepo();
  addValidEvidence(d);
  writeSrc(d, "apps/platform-api/src/x.ts", `const m = await import("@platform/${PKG}");\n`);
  assert.equal(status(d).signals.sourceImport, true);
});

test("4. root package.json dependency -> blocker", () => {
  const d = mkRepo();
  addValidEvidence(d);
  fs.mkdirSync(path.join(d, "apps/other"), { recursive: true });
  fs.writeFileSync(
    path.join(d, "apps/other/package.json"),
    JSON.stringify({ dependencies: { [`@platform/${PKG}`]: "*" } })
  );
  assert.equal(status(d).signals.workspaceDep, true);
});

test("5. nested workspace dependency -> blocker", () => {
  const d = mkRepo();
  addValidEvidence(d);
  fs.mkdirSync(path.join(d, "packages/consumer"), { recursive: true });
  fs.writeFileSync(
    path.join(d, "packages/consumer/package.json"),
    JSON.stringify({ devDependencies: { [`@platform/${PKG}`]: "*" } })
  );
  assert.equal(status(d).signals.workspaceDep, true);
});

test("6. lockfile-only stale package -> blocker", () => {
  const d = mkRepo();
  addValidEvidence(d);
  fs.writeFileSync(
    path.join(d, "package-lock.json"),
    JSON.stringify({ packages: { [`packages/${PKG}`]: { name: `@platform/${PKG}` } } })
  );
  const s = status(d);
  assert.ok(s.signals.lockfile, "lockfile-only package must be detected");
  assert.equal(s.blocker, true);
});

test("7. loader alias -> blocker", () => {
  const d = mkRepo();
  addValidEvidence(d);
  fs.writeFileSync(path.join(d, "apps/platform-api/loader.mjs"), `import "@platform/${PKG}";\n`);
  assert.equal(status(d).signals.loaderAlias, true);
});

test("8. tsconfig reference -> blocker", () => {
  const d = mkRepo();
  addValidEvidence(d);
  fs.writeFileSync(
    path.join(d, "packages/tsconfig.packages.json"),
    JSON.stringify({ references: [{ path: `./${PKG}` }] })
  );
  assert.equal(status(d).signals.tsconfigRef, true);
});

test("9. boundary row -> blocker", () => {
  const d = mkRepo();
  addValidEvidence(d);
  fs.writeFileSync(
    path.join(d, "docs/architecture/import-boundary-rules.json"),
    JSON.stringify({ rules: [{ from: `@platform/${PKG}` }] })
  );
  assert.equal(status(d).signals.importBoundaryRow, true);
});

test("10. absent package with missing evidence -> blocker", () => {
  const d = mkRepo();
  const s = status(d);
  assert.equal(s.present, false);
  assert.equal(s.removalEvidenceOk, false);
  assert.equal(s.blocker, true);
});

test("11. absent package with valid structured evidence -> clean", () => {
  const d = mkRepo();
  addValidEvidence(d);
  const s = status(d);
  assert.equal(s.present, false);
  assert.equal(s.removalEvidenceOk, true);
  assert.equal(s.blocker, false);
});

test("12. package directory present -> blocker (even with valid evidence)", () => {
  const d = mkRepo();
  addValidEvidence(d);
  addPkgDir(d);
  const s = status(d);
  assert.ok(s.signals.dir);
  assert.equal(s.blocker, true);
});

test("structured evidence: a non-clean scan invalidates the bundle", () => {
  const d = mkRepo();
  addValidEvidence(d);
  const p = path.join(d, `docs/evidence/lifecycle/removal/${PKG}/removal-evidence.json`);
  const ev = JSON.parse(fs.readFileSync(p, "utf8"));
  ev.consumerScan = { status: "dirty", count: 2, details: "2 importers" };
  fs.writeFileSync(p, JSON.stringify(ev));
  assert.equal(validateRemovalEvidence(d, PKG).ok, false);
});
