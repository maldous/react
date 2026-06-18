import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanCtx } from "./fixtures.mjs";
import { AUDITED_V1_COMMIT } from "../src/vocab.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, "../src/index.mjs");

const run = (args, cwd) => {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: (e.stdout || "") + (e.stderr || "") };
  }
};

// Materialise a clean temp repo (cleanCtx data) so the CLI exits 0.
function materialiseClean() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v2r-"));
  const D = path.join(dir, "docs/v2-foundation");
  fs.mkdirSync(D, { recursive: true });
  const c = cleanCtx();
  fs.writeFileSync(path.join(D, "v1-to-v2-path-map.json"), JSON.stringify(c.pathMap));
  fs.writeFileSync(path.join(D, "v2-command-map.json"), JSON.stringify(c.commandMap));
  fs.writeFileSync(path.join(D, "v2-test-proof-map.json"), JSON.stringify(c.testMap));
  fs.writeFileSync(path.join(D, "v1-capability-closure.json"), JSON.stringify(c.capabilities));
  fs.writeFileSync(path.join(D, "v2-decision-catalog.json"), JSON.stringify(c.decisions));
  fs.writeFileSync(path.join(D, "zero-gap-reconciliation.json"), JSON.stringify(c.reconciliation));
  fs.writeFileSync(path.join(D, "v2-target-tree.txt"), c.targetTree);
  fs.writeFileSync(path.join(D, "gap-report.md"), c.gapReport);
  fs.writeFileSync(path.join(D, "v1-completion-programme.md"), c.programme);
  // runbook does NOT mention the tool here, so R8 skips tool/script checks; keep the audited SHA.
  fs.writeFileSync(
    path.join(D, "v2-branch-cut-runbook.md"),
    `clean fixture runbook; audited ${AUDITED_V1_COMMIT}.`
  );
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ scripts: c.packageJsonScripts })
  );
  return dir;
}

test("exit 0 on a clean repo", () => {
  const dir = materialiseClean();
  const r = run(["--strict"], dir);
  assert.equal(r.code, 0, r.stdout);
});

test("exit 1 (RED) on the live repo with --json shape", () => {
  const repoRoot = path.join(here, "../../..");
  const r = run(["--strict", "--json", "--repo", repoRoot], repoRoot);
  assert.equal(r.code, 1);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, false);
  assert.ok(Array.isArray(report.findings));
  assert.equal(report.pinnedV1Commit, AUDITED_V1_COMMIT);
  assert.equal(typeof report.totalRules, "number");
});

test("exit 2 on a missing/unreadable repo", () => {
  const r = run(["--repo", "/no/such/repo/here"], here);
  assert.equal(r.code, 2);
});
