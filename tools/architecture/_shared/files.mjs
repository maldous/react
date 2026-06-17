import fs from "node:fs";
import path from "node:path";

// Recursively collect package.json paths under `current`, accumulating into
// `results`. Prunes directories whose basename is in `ignored`, and — unless
// `explicitFixtureScan` is set — directories the injected `isFixtureDir`
// predicate flags. The predicate stays tool-specific (each tool decides what
// counts as a fixture path); this is the exact skeleton previously duplicated
// as walkMetadata/walkReadmes/walkInventory/walkForPackageJson.
export function walkPackageJson(current, results, { ignored, isFixtureDir, explicitFixtureScan }) {
  const stat = fs.statSync(current);
  if (stat.isDirectory()) {
    const base = path.basename(current);
    if (ignored.has(base)) return;
    if (!explicitFixtureScan && isFixtureDir(current)) return;
    for (const entry of fs.readdirSync(current)) {
      walkPackageJson(path.join(current, entry), results, {
        ignored,
        isFixtureDir,
        explicitFixtureScan,
      });
    }
    return;
  }
  if (path.basename(current) === "package.json") {
    results.push(current);
  }
}
