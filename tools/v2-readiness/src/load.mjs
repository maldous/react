import fs from "node:fs";
import path from "node:path";
import { AUDITED_V1_COMMIT } from "./vocab.mjs";

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const readText = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");

// Build the validation context from the live repo. Pure rules consume this object;
// tests can also construct a ctx literal directly.
export function loadContext({ repoRoot = process.cwd(), strict = false, pinned } = {}) {
  const D = path.join(repoRoot, "docs/v2-foundation");
  const j = (name) => readJson(path.join(D, name));
  const t = (name) => readText(path.join(D, name));
  const pkg = readJson(path.join(repoRoot, "package.json"));
  return {
    repoRoot,
    strict,
    pinnedV1Commit: pinned ?? AUDITED_V1_COMMIT,
    pathMap: j("v1-to-v2-path-map.json"),
    commandMap: j("v2-command-map.json"),
    testMap: j("v2-test-proof-map.json"),
    capabilities: j("v1-capability-closure.json"),
    decisions: j("v2-decision-catalog.json"),
    reconciliation: j("zero-gap-reconciliation.json"),
    targetTree: t("v2-target-tree.txt"),
    gapReport: t("gap-report.md"),
    programme: t("v1-completion-programme.md"),
    runbook: t("v2-branch-cut-runbook.md"),
    packageJsonScripts: pkg.scripts || {},
    toolIndexExists: fs.existsSync(path.join(repoRoot, "tools/v2-readiness/src/index.mjs")),
  };
}
