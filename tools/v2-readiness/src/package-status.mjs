import fs from "node:fs";
import path from "node:path";

const exists = (p) => fs.existsSync(p);
const readText = (p) => (exists(p) ? fs.readFileSync(p, "utf8") : "");

// Walk source roots once, collecting @platform/<name> import specifiers -> [importing files].
export function collectImportMap(repoRoot, roots = ["apps", "packages", "tools", "services"]) {
  const map = {};
  const skip = new Set(["node_modules", ".git", "dist", "build", "coverage", ".turbo"]);
  const re = /['"]@platform\/([a-z0-9-]+)['"]/g;
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
      else if (/\.(ts|tsx|mjs|js|cjs)$/.test(e.name)) {
        const txt = readText(full);
        let m;
        while ((m = re.exec(txt))) (map[m[1]] ||= new Set()).add(full);
      }
    }
  };
  for (const r of roots) walk(path.join(repoRoot, r));
  return map;
}

// Determine live removal status for a deprecated package. Blocker clears only when the package is
// genuinely gone (dir + all cleanup refs absent, no external import) AND removal evidence validates.
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
  signals.tsconfigRef = new RegExp(`\\b${pkg}\\b`).test(
    readText(R("packages/tsconfig.packages.json"))
  );
  signals.importBoundaryRow = new RegExp(`@platform/${pkg}\\b|packages/${pkg}\\b|"${pkg}"`).test(
    readText(R("docs/architecture/import-boundary-rules.json"))
  );
  // external source import: some file OUTSIDE packages/<pkg> imports @platform/<pkg>
  const importers = (importMap && importMap[pkg]) || new Set();
  signals.sourceImport = [...importers].some((f) => !f.includes(`packages/${pkg}/`));
  // workspace dependency: another package.json declares @platform/<pkg>
  signals.workspaceDep = workspaceDependsOn(repoRoot, pkg);

  const present = Object.values(signals).some(Boolean);

  // removal evidence convention: docs/evidence/lifecycle/removal/<pkg>.md, validating with a clean scan marker
  const evPath = R(`docs/evidence/lifecycle/removal/${pkg}.md`);
  const evText = readText(evPath);
  const removalEvidenceOk =
    exists(evPath) && /consumer scan:\s*clean/i.test(evText) && /removed/i.test(evText);

  const removed = !present;
  const blocker = present || !removalEvidenceOk;
  const reasons = Object.entries(signals)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (!removalEvidenceOk) reasons.push("removal-evidence-missing-or-invalid");
  return { pkg, present, removed, removalEvidenceOk, blocker, signals, reasons };
}

function workspaceDependsOn(repoRoot, pkg) {
  const spec = `@platform/${pkg}`;
  const roots = ["packages", "apps", "services"];
  for (const root of roots) {
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
      ]) {
        if (pj[field] && Object.prototype.hasOwnProperty.call(pj[field], spec)) return true;
      }
    }
  }
  return false;
}
