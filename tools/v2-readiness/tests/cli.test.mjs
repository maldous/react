import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRules } from "../src/index.mjs";
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

// exit 0 path: a fully-consistent, blocker-free context yields no findings (the CLI exits 0 when
// findings is empty). Asserted at the unit level — a synthetic temp repo cannot satisfy the
// git-ls-tree(audited-commit) independent check, so exit-0 is proven here rather than via spawn.
test("exit 0 path: clean context produces zero findings", () => {
  assert.deepEqual(runRules(cleanCtx()), []);
});

test("live repo is cut-ready with --json shape", () => {
  const repoRoot = path.join(here, "../../..");
  const r = run(["--strict", "--json", "--repo", repoRoot], repoRoot);
  assert.equal(r.code, 0);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.consistencyFindings, 0);
  assert.equal(report.completionBlockerCount, 0);
  assert.ok(Array.isArray(report.findings));
  assert.equal(report.auditBaseCommit, AUDITED_V1_COMMIT);
  assert.match(report.cutCandidateCommit, /^[0-9a-f]{7,40}$/);
  assert.equal(typeof report.totalRules, "number");
});

test("exit 2 on a missing/unreadable repo", () => {
  const r = run(["--repo", "/no/such/repo/here"], here);
  assert.equal(r.code, 2);
});
