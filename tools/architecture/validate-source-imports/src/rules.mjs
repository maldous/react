import fs from "node:fs";
import path from "node:path";
import { findPackageRoot } from "./scanner.mjs";

const RULES_JSON_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../docs/architecture/import-boundary-rules.json"
);

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
