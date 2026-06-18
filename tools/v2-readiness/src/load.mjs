import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { AUDITED_V1_COMMIT } from "./vocab.mjs";

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const readText = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
const readJsonSafe = (p) => {
  try {
    return readJson(p);
  } catch {
    return null;
  }
};

// Parse Make rule heads from Makefile + make/*.mk.
function loadMakeTargets(repoRoot) {
  const files = [path.join(repoRoot, "Makefile")];
  const mkDir = path.join(repoRoot, "make");
  if (fs.existsSync(mkDir))
    for (const f of fs.readdirSync(mkDir)) if (f.endsWith(".mk")) files.push(path.join(mkDir, f));
  const targets = new Set();
  for (const f of files) {
    for (const line of readText(f).split("\n")) {
      const m = /^([a-zA-Z0-9_-]+):/.exec(line);
      if (m && !line.startsWith("\t")) targets.add(m[1]);
    }
  }
  return [...targets];
}

// Set of ADR numeric ids (NNNN) from docs/adr/*.md filenames.
function loadAdrIds(repoRoot) {
  const dir = path.join(repoRoot, "docs/adr");
  const ids = new Set();
  if (fs.existsSync(dir))
    for (const f of fs.readdirSync(dir)) {
      const m = /^(\d{4})-/.exec(f);
      if (m) ids.add(m[1]);
    }
  return ids;
}

// Every ADR-ACT-NNNN id mentioned anywhere in the ADR corpus (the register is sparse; many actions
// are documented only inside ADR bodies). Existence universe for lineage action references.
function loadActionMentions(repoRoot) {
  const dir = path.join(repoRoot, "docs/adr");
  const ids = new Set();
  if (fs.existsSync(dir))
    for (const f of fs.readdirSync(dir))
      if (f.endsWith(".md"))
        for (const m of readText(path.join(dir, f)).matchAll(/ADR-ACT-\d{4}/g)) ids.add(m[0]);
  return ids;
}

// Parse ACTION-REGISTER rows: id -> coarse status (best-effort from the row text).
function loadActionRegister(repoRoot) {
  const txt = readText(path.join(repoRoot, "docs/adr/ACTION-REGISTER.md"));
  const rows = {};
  for (const line of txt.split("\n")) {
    const m = /\|\s*(ADR-ACT-\d{4})\s*\|/.exec(line);
    if (!m) continue;
    let status = "unknown";
    if (/\bDone\b/.test(line)) status = "Done";
    else if (/\bIn Progress\b/i.test(line)) status = "In Progress";
    else if (/\bProposed\b/i.test(line)) status = "Proposed";
    else if (/\bDeferred\b/i.test(line)) status = "Deferred";
    else if (/\bSuperseded\b/i.test(line)) status = "Superseded";
    rows[m[1]] = status;
  }
  return rows;
}

// Files tracked at the audited commit (read-only). Empty + ok:false if git/commit unavailable.
function loadGitTrackedAtCommit(repoRoot, sha) {
  try {
    const out = execFileSync("git", ["-C", repoRoot, "ls-tree", "-r", "--name-only", sha], {
      encoding: "utf8",
    });
    return { files: out.split("\n").filter(Boolean), ok: true };
  } catch {
    return { files: [], ok: false };
  }
}

// Build the validation context from the live repo. Pure rules consume this object;
// tests can also construct a ctx literal directly.
export function loadContext({ repoRoot = process.cwd(), strict = false, pinned } = {}) {
  const D = path.join(repoRoot, "docs/v2-foundation");
  const j = (name) => readJson(path.join(D, name));
  const t = (name) => readText(path.join(D, name));
  const optional = (name) => readJsonSafe(path.join(D, name));
  const pkg = readJson(path.join(repoRoot, "package.json"));

  // inventory shards (docs/v2-foundation/shards/inventory-*.json) concatenated
  const shardsDir = path.join(D, "shards");
  let shards = [];
  if (fs.existsSync(shardsDir))
    for (const f of fs.readdirSync(shardsDir).sort())
      if (/^inventory-\d+\.json$/.test(f))
        shards = shards.concat(readJson(path.join(shardsDir, f)));

  return {
    repoRoot,
    strict,
    pinnedV1Commit: pinned ?? AUDITED_V1_COMMIT,
    auditedCommit: AUDITED_V1_COMMIT,
    // planning artefacts
    pathMap: j("v1-to-v2-path-map.json"),
    fileInventory: j("v1-file-inventory.json"),
    shards,
    commandMap: j("v2-command-map.json"),
    commandCatalog: j("v1-command-catalog.json"),
    testMap: j("v2-test-proof-map.json"),
    testInventory: j("v1-test-proof-inventory.json"),
    capabilities: j("v1-capability-closure.json"),
    decisions: j("v2-decision-catalog.json"),
    decisionLineage: j("v2-decision-lineage.json"),
    reconciliation: j("zero-gap-reconciliation.json"),
    directoryContracts: j("v2-directory-contracts.json"),
    targetTree: t("v2-target-tree.txt"),
    gapReport: t("gap-report.md"),
    programme: t("v1-completion-programme.md"),
    runbook: t("v2-branch-cut-runbook.md"),
    // foundation artefacts (shape-checked by R14)
    foundation: {
      "service-and-clickthrough-matrix.json": optional("service-and-clickthrough-matrix.json"),
      "authentication-authorisation-matrix.json": optional(
        "authentication-authorisation-matrix.json"
      ),
      "environment-and-config-catalog.json": optional("environment-and-config-catalog.json"),
      "data-and-migration-plan.json": optional("data-and-migration-plan.json"),
      "v1-knowledge-ledger.json": optional("v1-knowledge-ledger.json"),
      "v2-directory-contracts.json": optional("v2-directory-contracts.json"),
      "ui-definition.schema.json": optional("ui-definition.schema.json"),
      "ui-component-contracts.json": optional("ui-component-contracts.json"),
      "ui-capability-model.json": optional("ui-capability-model.json"),
    },
    // live repo facts
    gitTracked: loadGitTrackedAtCommit(repoRoot, AUDITED_V1_COMMIT),
    makeTargets: loadMakeTargets(repoRoot),
    adrIds: loadAdrIds(repoRoot),
    actionMentions: loadActionMentions(repoRoot),
    actionRegister: loadActionRegister(repoRoot),
    packageJsonScripts: pkg.scripts || {},
    listTestFiles: () => {
      try {
        const out = execFileSync(
          "git",
          [
            "-C",
            repoRoot,
            "ls-files",
            "*.test.ts",
            "*.test.tsx",
            "*.test.mjs",
            "*.test.js",
            "*.spec.ts",
            "*.spec.tsx",
          ],
          { encoding: "utf8" }
        );
        return out.split("\n").filter(Boolean);
      } catch {
        return null;
      }
    },
    fileExists: (rel) => fs.existsSync(path.join(repoRoot, rel)),
    toolIndexExists: fs.existsSync(path.join(repoRoot, "tools/v2-readiness/src/index.mjs")),
  };
}
