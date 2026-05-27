import path from "node:path";
import { createRequire } from "node:module";
import { findPackageRoot } from "./scanner.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");

export function buildModuleResolver({ repoRoot, packageMap, tsConfig }) {
  const syntheticPaths = {};
  for (const [name, info] of packageMap) {
    if (info.entryPoint) {
      syntheticPaths[name] = [info.entryPoint];
    }
  }

  // tsConfig.rawPaths are user-defined aliases (relative to tsconfig baseUrl).
  // Synthetic paths are absolute entryPoints from packageMap.
  // Synthetic paths take precedence so @platform/* and @architecture/* always
  // resolve to the repo source rather than any tsconfig redefinition.
  const mergedPaths = { ...tsConfig.rawPaths, ...syntheticPaths };

  // Use the tsconfig's resolved baseUrl when available (paths are relative to it).
  // Fall back to repoRoot so synthetic absolute paths still work without a tsconfig.
  const resolvedBaseUrl = tsConfig.compilerOptions.baseUrl ?? repoRoot;

  const compilerOptions = {
    ...tsConfig.compilerOptions,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    baseUrl: resolvedBaseUrl,
    paths: mergedPaths,
  };

  const resolutionCache = ts.createModuleResolutionCache(repoRoot, (x) => x, compilerOptions);

  const tsConfigPaths = Object.keys(tsConfig.rawPaths);

  function resolve(specifier, containingFile) {
    try {
      const result = ts.resolveModuleName(
        specifier,
        containingFile,
        compilerOptions,
        ts.sys,
        resolutionCache
      );
      const resolvedFile = result.resolvedModule?.resolvedFileName ?? null;
      if (!resolvedFile) {
        return { resolvedFile: null, resolvedPackage: null, isExternal: false };
      }
      const isExternal =
        resolvedFile.includes(`${path.sep}node_modules${path.sep}`) ||
        resolvedFile.includes("/node_modules/");
      if (isExternal) {
        return { resolvedFile, resolvedPackage: null, isExternal: true };
      }
      const pkgInfo = findPackageRoot(resolvedFile);
      return {
        resolvedFile,
        resolvedPackage: pkgInfo?.packageName ?? null,
        isExternal: false,
      };
    } catch {
      return { resolvedFile: null, resolvedPackage: null, isExternal: false };
    }
  }

  return { resolve, tsConfigPaths };
}
