import fs from "node:fs";
import path from "node:path";
import { findPackageRoot } from "./scanner.mjs";

const RULES_JSON_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../docs/architecture/import-boundary-rules.json"
);

function loadDeprecatedExceptions() {
  const parsed = JSON.parse(fs.readFileSync(RULES_JSON_PATH, "utf8"));
  return Array.isArray(parsed.deprecatedImportExceptions) ? parsed.deprecatedImportExceptions : [];
}

// Documented, narrow exceptions where an importer may still depend on a
// lifecycle.stage=deprecated package (e.g. an in-flight migration shim). Each
// entry is { from, to, reason }. Empty by default — deprecated packages have
// zero source consumers, so no exception is currently warranted (ADR-ACT-0288).
export const DEPRECATED_IMPORT_EXCEPTIONS = loadDeprecatedExceptions();

// Resolve the bare package name a specifier targets: "@scope/name/sub" -> "@scope/name".
function packageNameOf(specifier) {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

// Pure, metadata-DRIVEN deprecated-import check (no hard-coded package names):
// returns the deprecated target package name when `importerPackage` importing
// `specifier` is a forbidden new edge into a lifecycle.stage=deprecated package,
// or null when it is allowed (target not deprecated / not in the map / a
// self-reference / covered by a documented exception). The deprecated set is
// derived live from the package map's architecture.lifecycle.stage.
export function deprecatedImportTarget(
  importerPackage,
  specifier,
  packageMap,
  exceptions = DEPRECATED_IMPORT_EXCEPTIONS
) {
  if (!packageMap) return null;
  const target = packageNameOf(specifier);
  const info = packageMap.get(target);
  if (!info) return null;
  if (info.architecture?.lifecycle?.stage !== "deprecated") return null;
  if (importerPackage === target) return null; // a deprecated package may reference itself
  const exempt = exceptions.some((e) => e.from === importerPackage && e.to === target);
  return exempt ? null : target;
}

function loadPackageRules() {
  const { packageRules } = JSON.parse(fs.readFileSync(RULES_JSON_PATH, "utf8"));

  const result = {};
  for (const rule of packageRules) {
    const { id, appliesTo, forbiddenPrefixes, forbiddenExact } = rule;
    for (const pkg of appliesTo) {
      if (!result[pkg]) result[pkg] = [];
      result[pkg].push({
        id,
        match(specifier) {
          if (forbiddenExact.includes(specifier)) return true;
          return forbiddenPrefixes.some((p) => specifier.startsWith(p));
        },
        message(packageName, specifier) {
          return `${packageName} must not import ${specifier}`;
        },
      });
    }
  }
  return result;
}

export const UNIVERSAL_RULES = [
  {
    id: "no-deep-import",
    productionOnly: false,
    match(specifier) {
      if (!specifier.startsWith("@platform/")) return false;
      return specifier.slice("@platform/".length).includes("/");
    },
    message(pkg, specifier) {
      return `${pkg} must not use deep import: ${specifier}`;
    },
  },
  {
    id: "no-test-support-in-prod",
    productionOnly: true,
    match(specifier) {
      return specifier === "@platform/test-support";
    },
    message(pkg, _specifier) {
      return `${pkg}: production files must not import @platform/test-support`;
    },
  },
  {
    id: "no-relative-cross-package-import",
    productionOnly: false,
    match(specifier, fileInfo) {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) return false;
      const resolved = path.resolve(path.dirname(fileInfo.file), specifier);
      const importedPkg = findPackageRoot(resolved);
      if (!importedPkg) return false;
      return importedPkg.packageRoot !== fileInfo.packageRoot;
    },
    message(pkg, specifier) {
      return `${pkg} must not use relative cross-package import: ${specifier}`;
    },
  },
  {
    id: "no-architecture-in-product",
    productionOnly: false,
    match(specifier, fileInfo) {
      return (
        fileInfo.packageName.startsWith("@platform/") && specifier.startsWith("@architecture/")
      );
    },
    message(pkg, specifier) {
      return `${pkg} must not import architecture tooling: ${specifier}`;
    },
  },
];

export const PACKAGE_RULES = loadPackageRules();
