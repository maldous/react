import fs from "node:fs";
import path from "node:path";
import { extractImports, packageNameOf } from "../../architecture/_shared/import-edges.mjs";

const exists = (p) => fs.existsSync(p);
const readText = (p) => (exists(p) ? fs.readFileSync(p, "utf8") : "");

// Walk source roots once, collecting @platform/<name> -> [importing files], using the CANONICAL
// TypeScript-AST parser shared with validate-source-imports (static import/export-from, import-equals,
// type-only, dynamic import()/require(); subpath @platform/pkg/sub resolves to the owning package).
export function collectImportMap(repoRoot, roots = ["apps", "packages", "tools", "services"]) {
  const map = {};
  const skip = new Set(["node_modules", ".git", "dist", "build", "coverage", ".turbo"]);
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs|js|cjs)$/.test(e.name) && !full.endsWith(".d.ts")) {
        let edges;
        try {
          edges = extractImports(readText(full), full).imports;
        } catch {
          continue;
        }
        for (const spec of edges) {
          if (!spec.startsWith("@platform/")) continue;
          const pkg = packageNameOf(spec).slice("@platform/".length);
          (map[pkg] ||= new Set()).add(full);
        }
      }
    }
  };
  for (const r of roots) walk(path.join(repoRoot, r));
  return map;
}

// Does any package-lock.json still carry the workspace package?
function lockfileCarries(repoRoot, pkg) {
  const locks = [
    "package-lock.json",
    "apps/web/package-lock.json",
    "services/mock-oidc/package-lock.json",
  ];
  const needle = new RegExp(`packages/${pkg}"|@platform/${pkg}"`);
  for (const l of locks) if (needle.test(readText(path.join(repoRoot, l)))) return true;
  return false;
}

function workspaceDependsOn(repoRoot, pkg) {
  const spec = `@platform/${pkg}`;
  for (const root of ["packages", "apps", "services"]) {
    let dirs;
    try {
      dirs = fs.readdirSync(path.join(repoRoot, root), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dirs) {
      if (!d.isDirectory() || d.name === pkg) continue;
      const pjPath = path.join(repoRoot, root, d.name, "package.json");
      if (!exists(pjPath)) continue;
      let pj;
      try {
        pj = JSON.parse(readText(pjPath));
      } catch {
        continue;
      }
      for (const field of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ])
        if (pj[field] && Object.prototype.hasOwnProperty.call(pj[field], spec)) return true;
    }
  }
  return false;
}

const REQUIRED_EVIDENCE_FIELDS = [
  "schemaVersion",
  "package",
  "removedAt",
  "sourceCommit",
  "removalCommit",
  "replacement",
  "decisionRefs",
  "commandsRun",
  "consumerScan",
  "workspaceDependencyScan",
  "loaderAliasScan",
  "tsconfigReferenceScan",
  "boundaryRuleScan",
  "lockfileScan",
  "inventoryScan",
  "tests",
  "makeCheckResult",
  "orchestratorResult",
];
const SCAN_FIELDS = [
  "consumerScan",
  "workspaceDependencyScan",
  "loaderAliasScan",
  "tsconfigReferenceScan",
  "boundaryRuleScan",
  "lockfileScan",
  "inventoryScan",
];

// Structured, schema-validated removal evidence (§3). Markdown is not the source of truth.
export function validateRemovalEvidence(repoRoot, pkg) {
  const p = path.join(repoRoot, `docs/evidence/lifecycle/removal/${pkg}/removal-evidence.json`);
  if (!exists(p)) return { ok: false, reason: "evidence-file-missing" };
  let ev;
  try {
    ev = JSON.parse(readText(p));
  } catch {
    return { ok: false, reason: "evidence-not-json" };
  }
  for (const f of REQUIRED_EVIDENCE_FIELDS)
    if (!(f in ev)) return { ok: false, reason: `evidence-missing-${f}` };
  if (ev.package !== pkg) return { ok: false, reason: "evidence-package-mismatch" };
  for (const s of SCAN_FIELDS) {
    const scan = ev[s] || {};
    if (scan.status !== "clean") return { ok: false, reason: `${s}-not-clean` };
    if (typeof scan.count === "number" && scan.count !== 0)
      return { ok: false, reason: `${s}-count-nonzero` };
  }
  return { ok: true, reason: "valid" };
}

// Determine live removal status for a deprecated package. Blocker clears only when the package is
// genuinely gone (dir + all cleanup refs absent, no external import, not in any lockfile) AND
// structured removal evidence validates.
export function packageRemovalStatus(
  repoRoot,
  pkg,
  { importMap, loaderPath = "apps/platform-api/loader.mjs" } = {}
) {
  const R = (p) => path.join(repoRoot, p);
  const signals = {};
  signals.dir = exists(R(`packages/${pkg}`));
  signals.lifecycleMetadata = exists(R(`packages/${pkg}/package.json`));
  signals.loaderAlias = new RegExp(`@platform/${pkg}\\b|packages/${pkg}\\b`).test(
    readText(R(loaderPath))
  );
  // Match the exact project-reference path ("./<pkg>"), not a bare word — otherwise a
  // substring package name (e.g. "observability" inside "./platform-observability") yields
  // a false positive that can never clear while the sibling package legitimately remains.
  signals.tsconfigRef = new RegExp(`"\\./${pkg}"`).test(
    readText(R("packages/tsconfig.packages.json"))
  );
  signals.importBoundaryRow = new RegExp(`@platform/${pkg}\\b|packages/${pkg}\\b|"${pkg}"`).test(
    readText(R("docs/architecture/import-boundary-rules.json"))
  );
  const importers = (importMap && importMap[pkg]) || new Set();
  signals.sourceImport = [...importers].some((f) => !f.includes(`packages/${pkg}/`));
  signals.workspaceDep = workspaceDependsOn(repoRoot, pkg);
  signals.lockfile = lockfileCarries(repoRoot, pkg);

  const present = Object.values(signals).some(Boolean);
  const evidence = validateRemovalEvidence(repoRoot, pkg);
  const removalEvidenceOk = evidence.ok;
  const removed = !present;
  const blocker = present || !removalEvidenceOk;
  const reasons = Object.entries(signals)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (!removalEvidenceOk) reasons.push(`removal-evidence:${evidence.reason}`);
  return { pkg, present, removed, removalEvidenceOk, blocker, signals, reasons };
}
