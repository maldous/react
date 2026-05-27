import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

export function loadTsConfig(explicitPath, scanRoots, repoRoot) {
  if (explicitPath) {
    return parseTsConfigFile(path.resolve(explicitPath));
  }
  for (const root of scanRoots) {
    const candidate = path.join(path.resolve(repoRoot, root), "tsconfig.json");
    if (fs.existsSync(candidate)) {
      return parseTsConfigFile(candidate);
    }
  }
  return { compilerOptions: {}, rawPaths: {}, configPath: null };
}

function parseTsConfigFile(configPath) {
  const readResult = ts.readConfigFile(configPath, ts.sys.readFile);
  if (readResult.error) {
    return { compilerOptions: {}, rawPaths: {}, configPath: null };
  }
  const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, path.dirname(configPath));
  const rawPaths = readResult.config?.compilerOptions?.paths ?? {};
  return { compilerOptions: parsed.options, rawPaths, configPath };
}
