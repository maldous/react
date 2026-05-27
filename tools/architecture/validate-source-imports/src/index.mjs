#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { UNIVERSAL_RULES, PACKAGE_RULES } from "./rules.mjs";
import { scanRoots } from "./scanner.mjs";
import { buildPackageMap } from "./package-map.mjs";
import { loadTsConfig } from "./tsconfig-loader.mjs";
import { buildModuleResolver } from "./module-resolver.mjs";
import {
  buildJsonReport,
  buildMarkdownReport,
  writeReports,
  writeCommittedEvidence,
  writeSelfEvidence,
} from "./reporter.mjs";

function parseArgs(argv) {
  const options = {
    root: null,
    format: "text",
    noReports: false,
    write: false,
    strict: false,
    tsconfig: null,
    roots: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--root") {
      options.root = argv[++index];
      continue;
    }

    if (arg === "--format") {
      options.format = argv[++index] ?? "text";
      continue;
    }

    if (arg === "--no-reports") {
      options.noReports = true;
      continue;
    }

    if (arg === "--check") {
      options.write = false;
      continue;
    }

    if (arg === "--write") {
      options.write = true;
      continue;
    }

    if (arg === "--strict") {
      options.strict = true;
      continue;
    }

    if (arg === "--tsconfig") {
      options.tsconfig = argv[++index];
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options.roots.push(arg);
  }

  if (!["text", "json"].includes(options.format)) {
    throw new Error("--format must be text or json");
  }

  return options;
}

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, "docs", "schemas", "package-json-architecture.schema.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.resolve(startDir);
    }
    dir = parent;
  }
}

function readToolVersion(repoRoot) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "tools", "architecture", "validate-source-imports", "package.json"),
        "utf8"
      )
    );
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function matchesTsConfigPath(specifier, tsConfigPaths) {
  for (const pattern of tsConfigPaths) {
    if (pattern.endsWith("/*")) {
      if (specifier.startsWith(pattern.slice(0, -1))) return true;
    } else if (specifier === pattern) {
      return true;
    }
  }
  return false;
}

function classifySpecifier(specifier, tsConfigPaths) {
  if (specifier.startsWith("./") || specifier.startsWith("../")) return "relative";
  if (specifier.startsWith("@platform/")) return "platform";
  if (specifier.startsWith("@architecture/")) return "architecture";
  if (specifier.startsWith("node:")) return "node-builtin";
  if (tsConfigPaths.length > 0 && matchesTsConfigPath(specifier, tsConfigPaths)) return "alias";
  return "external";
}

function enrichEdges(files, resolver) {
  const tsConfigPaths = resolver.tsConfigPaths;
  for (const fileInfo of files) {
    for (const edge of fileInfo.importEdges) {
      const resolution = resolver.resolve(edge.specifier, fileInfo.file);
      edge.resolvedFile = resolution.resolvedFile;
      edge.resolvedPackage = resolution.resolvedPackage;
      edge.isExternal = resolution.isExternal;
      edge.resolutionStatus = resolution.resolvedFile ? "resolved" : "unresolved";
      edge.resolutionKind = classifySpecifier(edge.specifier, tsConfigPaths);
    }
  }
}

function buildPackageGraph(files) {
  const graph = new Map();
  for (const fileInfo of files) {
    if (!graph.has(fileInfo.packageName)) graph.set(fileInfo.packageName, new Set());
    for (const edge of fileInfo.importEdges) {
      let target = null;
      if (edge.resolvedPackage && !edge.isExternal) {
        target = edge.resolvedPackage;
      } else if (
        edge.specifier.startsWith("@platform/") &&
        !edge.specifier.slice("@platform/".length).includes("/") &&
        !edge.resolvedPackage
      ) {
        // raw fallback: keep unresolvable bare @platform/* imports for cycle detection
        target = edge.specifier;
      }
      if (target && target !== fileInfo.packageName) {
        graph.get(fileInfo.packageName).add(target);
      }
    }
  }
  return graph;
}

function detectCycles(graph) {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map();
  for (const node of graph.keys()) color.set(node, WHITE);
  const cycles = [];

  function dfs(node, stack) {
    color.set(node, GRAY);
    stack.push(node);
    for (const dep of graph.get(node) ?? new Set()) {
      if (!graph.has(dep)) continue;
      const c = color.get(dep) ?? WHITE;
      if (c === GRAY) {
        const cycleStart = stack.indexOf(dep);
        cycles.push([...stack.slice(cycleStart), dep]);
      } else if (c === WHITE) {
        dfs(dep, stack);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  }

  for (const node of graph.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) dfs(node, []);
  }
  return cycles;
}

function checkCycleViolations(files, packageGraph) {
  const cycles = detectCycles(packageGraph);
  return cycles.map((cycle) => {
    const packageName = cycle[0];
    const rep = files.find((f) => f.packageName === packageName);
    return {
      file: rep?.file ?? packageName,
      packageName,
      specifier: cycle[cycle.length - 1],
      rule: "no-package-cycle",
      message: `Package cycle detected: ${cycle.join(" → ")}`,
      resolvedFile: null,
      resolvedPackage: null,
    };
  });
}

function checkViolations(files, { strict = false, packageMap = null, resolver = null } = {}) {
  const tsConfigPaths = resolver?.tsConfigPaths ?? [];
  const violations = [];

  for (const fileInfo of files) {
    // Strict: computed dynamic imports cannot be statically analyzed
    if (strict && fileInfo.computedImports?.length > 0) {
      for (const ci of fileInfo.computedImports) {
        violations.push({
          file: fileInfo.file,
          packageName: fileInfo.packageName,
          specifier: "<computed>",
          rule: "no-computed-dynamic-import",
          message: `${fileInfo.packageName}: computed dynamic import at line ${ci.line} cannot be statically verified`,
          resolvedFile: null,
          resolvedPackage: null,
        });
      }
    }

    // Build edgeMap: specifier → first edge (carries resolved metadata from enrichEdges)
    const edgeMap = new Map();
    for (const edge of fileInfo.importEdges) {
      if (!edgeMap.has(edge.specifier)) edgeMap.set(edge.specifier, edge);
    }

    for (const specifier of fileInfo.imports) {
      const edge = edgeMap.get(specifier);

      for (const rule of UNIVERSAL_RULES) {
        if (rule.productionOnly && fileInfo.isTestFile) continue;
        if (rule.match(specifier, fileInfo)) {
          violations.push({
            file: fileInfo.file,
            packageName: fileInfo.packageName,
            specifier,
            rule: rule.id,
            message: rule.message(fileInfo.packageName, specifier),
            resolvedFile: edge?.resolvedFile ?? null,
            resolvedPackage: edge?.resolvedPackage ?? null,
          });
        }
      }

      const pkgRules = PACKAGE_RULES[fileInfo.packageName];
      if (pkgRules) {
        for (const rule of pkgRules) {
          if (rule.match(specifier)) {
            violations.push({
              file: fileInfo.file,
              packageName: fileInfo.packageName,
              specifier,
              rule: rule.id,
              message: rule.message(fileInfo.packageName, specifier),
              resolvedFile: edge?.resolvedFile ?? null,
              resolvedPackage: edge?.resolvedPackage ?? null,
            });
          }
        }
      }

      // no-unexported-subpath-import: @platform/x/subpath not in package exports
      if (
        specifier.startsWith("@platform/") &&
        specifier.slice("@platform/".length).includes("/")
      ) {
        const pkgName = "@platform/" + specifier.slice("@platform/".length).split("/")[0];
        const subpath = "." + specifier.slice(pkgName.length);
        const pkgInfo = packageMap?.get(pkgName);
        if (pkgInfo) {
          const pkgExports = pkgInfo.exports;
          if (!pkgExports || !pkgExports[subpath]) {
            violations.push({
              file: fileInfo.file,
              packageName: fileInfo.packageName,
              specifier,
              rule: "no-unexported-subpath-import",
              message: `${fileInfo.packageName} imports unexported subpath ${specifier} (not in ${pkgName} exports)`,
              resolvedFile: edge?.resolvedFile ?? null,
              resolvedPackage: edge?.resolvedPackage ?? null,
            });
          }
        }
      }

      // no-unexported-package-entry: bare @platform/* or @architecture/* that exists in packageMap
      // but the resolver cannot find its entry point (null entryPoint in packageMap)
      const isBareInternal =
        (specifier.startsWith("@platform/") &&
          !specifier.slice("@platform/".length).includes("/")) ||
        (specifier.startsWith("@architecture/") &&
          !specifier.slice("@architecture/".length).includes("/"));
      if (
        isBareInternal &&
        packageMap !== null &&
        packageMap.has(specifier) &&
        edge?.resolutionStatus === "unresolved"
      ) {
        violations.push({
          file: fileInfo.file,
          packageName: fileInfo.packageName,
          specifier,
          rule: "no-unexported-package-entry",
          message: `${fileInfo.packageName} imports ${specifier} which has no resolvable package entry point`,
          resolvedFile: null,
          resolvedPackage: null,
        });
      }

      // no-unlisted-platform-import: any import resolving to a @platform/* package not in dependsOn.
      // For bare @platform/* imports: use resolvedPackage if available, else raw specifier.
      // For alias imports that resolve to a @platform/* package: use resolvedPackage.
      {
        let targetPackage = null;
        const isBarePlatform =
          specifier.startsWith("@platform/") && !specifier.slice("@platform/".length).includes("/");
        if (isBarePlatform) {
          targetPackage = edge?.resolvedPackage ?? specifier;
        } else if (
          edge?.resolvedPackage?.startsWith("@platform/") &&
          !edge.resolvedPackage.slice("@platform/".length).includes("/")
        ) {
          targetPackage = edge.resolvedPackage;
        }

        if (
          targetPackage &&
          targetPackage !== fileInfo.packageName &&
          fileInfo.allowedPlatformDeps !== null &&
          !fileInfo.allowedPlatformDeps.includes(targetPackage)
        ) {
          violations.push({
            file: fileInfo.file,
            packageName: fileInfo.packageName,
            specifier,
            rule: "no-unlisted-platform-import",
            message: `${fileInfo.packageName} must not import ${targetPackage} (not in architecture.relations.dependsOn)`,
            resolvedFile: edge?.resolvedFile ?? null,
            resolvedPackage: edge?.resolvedPackage ?? null,
          });
        }
      }

      // Strict: @platform/* and @architecture/* bare imports must resolve to a known package
      if (strict && packageMap !== null) {
        const isPlatform =
          specifier.startsWith("@platform/") && !specifier.slice("@platform/".length).includes("/");
        const isArchitecture =
          specifier.startsWith("@architecture/") &&
          !specifier.slice("@architecture/".length).includes("/");
        if ((isPlatform || isArchitecture) && !packageMap.has(specifier)) {
          violations.push({
            file: fileInfo.file,
            packageName: fileInfo.packageName,
            specifier,
            rule: "no-unresolved-platform-import",
            message: `${fileInfo.packageName} imports ${specifier} which does not exist in the repository`,
            resolvedFile: null,
            resolvedPackage: null,
          });
        }
      }

      // Strict: tsconfig path aliases must resolve to an existing file
      if (
        strict &&
        resolver !== null &&
        tsConfigPaths.length > 0 &&
        !specifier.startsWith("@platform/") &&
        !specifier.startsWith("@architecture/") &&
        matchesTsConfigPath(specifier, tsConfigPaths)
      ) {
        if (edge?.resolutionStatus === "unresolved") {
          violations.push({
            file: fileInfo.file,
            packageName: fileInfo.packageName,
            specifier,
            rule: "no-unresolved-alias",
            message: `${fileInfo.packageName}: tsconfig path alias ${specifier} does not resolve to an existing file`,
            resolvedFile: null,
            resolvedPackage: null,
          });
        }
      }

      // Strict: relative imports must resolve to an existing file (via TypeScript resolver)
      if (
        strict &&
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        edge?.resolutionStatus === "unresolved"
      ) {
        violations.push({
          file: fileInfo.file,
          packageName: fileInfo.packageName,
          specifier,
          rule: "no-unresolved-relative-import",
          message: `${fileInfo.packageName}: relative import ${specifier} does not resolve to an existing file`,
          resolvedFile: null,
          resolvedPackage: null,
        });
      }
    }
  }

  return violations;
}

function computeEdgeStats(files) {
  let totalImports = 0;
  let totalResolvedImports = 0;
  let totalUnresolvedImports = 0;
  let totalInternalEdges = 0;
  let totalExternalEdges = 0;
  let totalTypeOnlyEdges = 0;
  let totalDynamicImports = 0;

  for (const fileInfo of files) {
    for (const edge of fileInfo.importEdges) {
      totalImports++;
      if (edge.resolutionStatus === "resolved") {
        totalResolvedImports++;
        if (!edge.isExternal) totalInternalEdges++;
        else totalExternalEdges++;
      } else {
        totalUnresolvedImports++;
      }
      if (edge.isTypeOnly) totalTypeOnlyEdges++;
      if (edge.isDynamic) totalDynamicImports++;
    }
  }

  return {
    totalImports,
    totalResolvedImports,
    totalUnresolvedImports,
    totalInternalEdges,
    totalExternalEdges,
    totalTypeOnlyEdges,
    totalDynamicImports,
  };
}

function printText(jsonReport, outputPaths, selfEvidencePath, repoRoot) {
  console.log(`Scanned ${jsonReport.totalFiles} file(s), ${jsonReport.totalImports} import(s).`);
  console.log(`Passed: ${jsonReport.passed}`);
  console.log(`Failed: ${jsonReport.failed}`);

  if (jsonReport.violations.length > 0) {
    console.log("\nViolations:");
    for (const v of jsonReport.violations) {
      console.log(`  ${v.file}: [${v.rule}] ${v.message}`);
    }
  }

  for (const { label, filePath } of outputPaths) {
    console.log(`${label}: ${path.relative(repoRoot, filePath)}`);
  }

  if (selfEvidencePath) {
    console.log(`Self-evidence: ${path.relative(repoRoot, selfEvidencePath)}`);
  }
}

function main() {
  const OPTIONS = parseArgs(process.argv.slice(2));
  const REPO_ROOT = findRepoRoot(OPTIONS.root ? path.resolve(OPTIONS.root) : process.cwd());
  const REPORT_DIR = path.join(REPO_ROOT, "reports", "validation");
  const TOOLING_REPORT_DIR = path.join(REPO_ROOT, "reports", "tooling", "validate-source-imports");

  const toolVersion = readToolVersion(REPO_ROOT);
  const startedAt = new Date().toISOString();

  const scanRootArgs = OPTIONS.roots.length > 0 ? OPTIONS.roots : ["apps", "packages"];
  const { files, warnings } = scanRoots(scanRootArgs, REPO_ROOT);
  const packageMap = buildPackageMap(REPO_ROOT);
  const tsConfig = loadTsConfig(OPTIONS.tsconfig, scanRootArgs, REPO_ROOT);
  const resolver = buildModuleResolver({ repoRoot: REPO_ROOT, packageMap, tsConfig });

  // Enrich every import edge with resolution metadata (resolvedFile, resolvedPackage, etc.)
  enrichEdges(files, resolver);

  const packageGraph = buildPackageGraph(files);
  const violations = checkViolations(files, { strict: OPTIONS.strict, packageMap, resolver });
  if (OPTIONS.strict) violations.push(...checkCycleViolations(files, packageGraph));

  const finishedAt = new Date().toISOString();
  const exitCode = violations.length > 0 ? 1 : 0;

  const edgeStats = computeEdgeStats(files);
  const compilerOptionsSummary = {
    moduleResolution: "Bundler",
    pathAliasCount: resolver.tsConfigPaths.length,
  };

  const jsonReport = buildJsonReport({
    generatedAt: finishedAt,
    files,
    violations,
    repoRoot: REPO_ROOT,
    toolVersion,
    scanMethod: "typescript-ast+typescript-module-resolution",
    strictMode: OPTIONS.strict,
    tsconfigPath: tsConfig.configPath ?? null,
    compilerOptionsSummary,
    edgeStats,
    packageGraph,
  });
  const markdownReport = buildMarkdownReport(jsonReport);

  const outputPaths = [];

  if (!OPTIONS.noReports) {
    const { jsonPath, mdPath } = writeReports(jsonReport, markdownReport, REPORT_DIR);
    outputPaths.push({ label: "JSON report", filePath: jsonPath });
    outputPaths.push({ label: "Markdown report", filePath: mdPath });
  }

  if (OPTIONS.write) {
    const { jsonPath, mdPath } = writeCommittedEvidence(
      jsonReport,
      REPO_ROOT,
      toolVersion,
      scanRootArgs
    );
    outputPaths.push({ label: "Evidence JSON", filePath: jsonPath });
    outputPaths.push({ label: "Evidence Markdown", filePath: mdPath });
  }

  let selfEvidencePath = null;
  if (!OPTIONS.noReports) {
    selfEvidencePath = writeSelfEvidence({
      toolName: "validate-source-imports",
      toolVersion,
      command: [
        "node",
        "tools/architecture/validate-source-imports/src/index.mjs",
        ...process.argv.slice(2),
      ],
      mode: OPTIONS.write ? "write" : "check",
      repoRoot: REPO_ROOT,
      startedAt,
      finishedAt,
      inputRoots: scanRootArgs,
      outputPaths: outputPaths.map((o) => path.relative(REPO_ROOT, o.filePath)),
      violations,
      checksPassed: jsonReport.passed,
      checksFailed: jsonReport.failed,
      warnings,
      exitCode,
      toolingReportDir: TOOLING_REPORT_DIR,
    });
  }

  if (OPTIONS.format === "json") {
    console.log(
      JSON.stringify(
        {
          toolName: "validate-source-imports",
          totalFiles: jsonReport.totalFiles,
          totalImports: jsonReport.totalImports,
          passed: jsonReport.passed,
          failed: jsonReport.failed,
          violations: jsonReport.violations,
          outputPaths: outputPaths.map((o) => path.relative(REPO_ROOT, o.filePath)),
          selfEvidencePath: selfEvidencePath ? path.relative(REPO_ROOT, selfEvidencePath) : null,
          exitCode,
        },
        null,
        2
      )
    );
  } else {
    printText(jsonReport, outputPaths, selfEvidencePath, REPO_ROOT);
  }

  process.exit(exitCode);
}

try {
  main();
} catch (error) {
  if (
    process.argv.includes("--format") &&
    process.argv[process.argv.indexOf("--format") + 1] === "json"
  ) {
    console.log(
      JSON.stringify(
        { toolName: "validate-source-imports", error: error.message, exitCode: 1 },
        null,
        2
      )
    );
  } else {
    console.error(error.message);
  }
  process.exit(1);
}
