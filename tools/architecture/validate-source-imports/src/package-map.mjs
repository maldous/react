import fs from "node:fs";
import path from "node:path";

/**
 * Build a map of all internal packages in the monorepo.
 * Scans apps/, packages/, tools/architecture/ for package.json files.
 * Returns a Map<packageName, packageInfo> where packageInfo includes:
 * - name: package.json name field
 * - root: absolute path to package directory
 * - exports: package.json exports field (if present)
 * - architecture: architecture metadata from package.json
 * - entryPoint: resolved ./src/index.ts or ./src/index.js if it exists
 */
const ENTRY_POINT_CANDIDATES = ["src/index.ts", "src/index.tsx", "src/index.js", "src/index.jsx"];

function resolveEntryPoint(packagePath) {
  for (const candidate of ENTRY_POINT_CANDIDATES) {
    const full = path.join(packagePath, candidate);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function loadPackageInfo(packagePath, packageJsonPath, scanDir) {
  const content = fs.readFileSync(packageJsonPath, "utf8");
  const pkg = JSON.parse(content);
  if (!pkg.name) return null;
  return {
    name: pkg.name,
    root: packagePath,
    exports: pkg.exports || null,
    architecture: pkg.architecture || null,
    entryPoint: resolveEntryPoint(packagePath),
    isInternal: scanDir !== "tools/architecture" || pkg.name.startsWith("@architecture/"),
  };
}

function scanPackageDir(basePath, scanDir, packageMap, seen) {
  const entries = fs.readdirSync(basePath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packagePath = path.join(basePath, entry.name);
    const packageJsonPath = path.join(packagePath, "package.json");
    if (!fs.existsSync(packageJsonPath)) continue;

    try {
      const info = loadPackageInfo(packagePath, packageJsonPath, scanDir);
      if (!info) continue;
      if (seen.has(info.name)) {
        throw new Error(`Duplicate package name: ${info.name} (in ${packagePath})`);
      }
      seen.add(info.name);
      packageMap.set(info.name, info);
    } catch (err) {
      if (err.message.startsWith("Duplicate package name")) throw err;
      // Skip packages with malformed package.json
    }
  }
}

export function buildPackageMap(repoRoot) {
  const packageMap = new Map();
  const seen = new Set();

  for (const scanDir of ["apps", "packages", "tools/architecture"]) {
    const basePath = path.join(repoRoot, scanDir);
    if (!fs.existsSync(basePath)) continue;
    scanPackageDir(basePath, scanDir, packageMap, seen);
  }

  return packageMap;
}

/**
 * Validate the package map for structural issues.
 * Returns { valid: boolean, errors: string[] }
 */
export function validatePackageMap(packageMap) {
  const errors = [];

  for (const [name, info] of packageMap) {
    // Check that architecture.publicExportsOnly implies exports exists
    if (info.architecture?.boundaries?.publicExportsOnly === true && !info.exports) {
      errors.push(`${name}: publicExportsOnly=true but no exports field in package.json`);
    }

    // Check that if exports is defined, the "." target exists
    if (info.exports && info.exports["."] && !info.entryPoint) {
      const target = info.exports["."].replace(/^\.\//, "");
      const full = path.join(info.root, target);
      if (!fs.existsSync(full)) {
        errors.push(`${name}: exports["."] points to non-existent file: ${target}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get the package that owns a file path.
 * Returns packageName or null if file is not in any package root.
 */
export function getPackageForFile(packageMap, filePath) {
  for (const [name, info] of packageMap) {
    if (filePath.startsWith(info.root + path.sep) || filePath === info.root) {
      return name;
    }
  }
  return null;
}
