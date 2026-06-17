#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { findRepoRoot as sharedFindRepoRoot } from "../../_shared/repo-root.mjs";
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

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--root") {
      options.root = argv[i + 1];
      i += 2;
    } else if (arg === "--format") {
      options.format = argv[i + 1] ?? "text";
      i += 2;
    } else if (arg === "--no-reports") {
      options.noReports = true;
      i += 1;
    } else if (arg === "--check") {
      options.write = false;
      i += 1;
    } else if (arg === "--write") {
      options.write = true;
      i += 1;
    } else if (arg === "--strict") {
      options.strict = true;
      i += 1;
    } else if (arg === "--tsconfig") {
      options.tsconfig = argv[i + 1];
      i += 2;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.roots.push(arg);
      i += 1;
    }
  }

  if (!["text", "json"].includes(options.format)) {
    throw new Error("--format must be text or json");
  }

  return options;
}

function findRepoRoot(startDir) {
  return sharedFindRepoRoot(startDir, "docs/schemas/package-json-architecture.schema.json");
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

function resolveEdgeTarget(edge) {
  if (edge.resolvedPackage && !edge.isExternal) {
    return edge.resolvedPackage;
  }
  if (
    edge.specifier.startsWith("@platform/") &&
    !edge.specifier.slice("@platform/".length).includes("/") &&
    !edge.resolvedPackage
  ) {
    // raw fallback: keep unresolvable bare @platform/* imports for cycle detection
    return edge.specifier;
  }
  return null;
}

function buildPackageGraph(files) {
  const graph = new Map();
  for (const fileInfo of files) {
    if (!graph.has(fileInfo.packageName)) graph.set(fileInfo.packageName, new Set());
    for (const edge of fileInfo.importEdges) {
      const target = resolveEdgeTarget(edge);
      if (target && target !== fileInfo.packageName) {
        graph.get(fileInfo.packageName).add(target);
      }
    }
  }
  return graph;
}

const CYCLE_WHITE = 0;
const CYCLE_GRAY = 1;
const CYCLE_BLACK = 2;

function dfsVisit(graph, color, cycles, node, stack) {
  color.set(node, CYCLE_GRAY);
  stack.push(node);
  for (const dep of graph.get(node) ?? new Set()) {
    if (!graph.has(dep)) continue;
    const c = color.get(dep) ?? CYCLE_WHITE;
    if (c === CYCLE_GRAY) {
      const cycleStart = stack.indexOf(dep);
      cycles.push([...stack.slice(cycleStart), dep]);
    } else if (c === CYCLE_WHITE) {
      dfsVisit(graph, color, cycles, dep, stack);
    }
  }
  stack.pop();
  color.set(node, CYCLE_BLACK);
}

function detectCycles(graph) {
  const color = new Map();
  for (const node of graph.keys()) color.set(node, CYCLE_WHITE);
  const cycles = [];
  for (const node of graph.keys()) {
    if ((color.get(node) ?? CYCLE_WHITE) === CYCLE_WHITE) dfsVisit(graph, color, cycles, node, []);
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
      message: `Package cycle detected: ${cycle.join(" ? ")}`,
      resolvedFile: null,
      resolvedPackage: null,
    };
  });
}

function makeViolation(fileInfo, specifier, edge, rule, message) {
  return {
    file: fileInfo.file,
    packageName: fileInfo.packageName,
    specifier,
    rule,
    message,
    resolvedFile: edge?.resolvedFile ?? null,
    resolvedPackage: edge?.resolvedPackage ?? null,
  };
}

function checkComputedImports(fileInfo, violations) {
  if (fileInfo.computedImports?.length > 0) {
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
}

function checkUniversalRules(fileInfo, specifier, edge, violations) {
  for (const rule of UNIVERSAL_RULES) {
    if (rule.productionOnly && fileInfo.isTestFile) continue;
    if (rule.match(specifier, fileInfo)) {
      violations.push(
        makeViolation(
          fileInfo,
          specifier,
          edge,
          rule.id,
          rule.message(fileInfo.packageName, specifier)
        )
      );
    }
  }
}

function checkPackageRules(fileInfo, specifier, edge, violations) {
  const pkgRules = PACKAGE_RULES[fileInfo.packageName];
  if (!pkgRules) return;
  for (const rule of pkgRules) {
    if (rule.match(specifier)) {
      violations.push(
        makeViolation(
          fileInfo,
          specifier,
          edge,
          rule.id,
          rule.message(fileInfo.packageName, specifier)
        )
      );
    }
  }
}

function checkSubpathImport(fileInfo, specifier, edge, packageMap, violations) {
  if (!specifier.startsWith("@platform/") || !specifier.slice("@platform/".length).includes("/"))
    return;
  const pkgName = "@platform/" + specifier.slice("@platform/".length).split("/")[0];
  const subpath = "." + specifier.slice(pkgName.length);
  const pkgInfo = packageMap?.get(pkgName);
  if (pkgInfo) {
    const pkgExports = pkgInfo.exports;
    if (!pkgExports || !pkgExports[subpath]) {
      violations.push(
        makeViolation(
          fileInfo,
          specifier,
          edge,
          "no-unexported-subpath-import",
          `${fileInfo.packageName} imports unexported subpath ${specifier} (not in ${pkgName} exports)`
        )
      );
    }
  }
}

function checkUnexportedPackageEntry(fileInfo, specifier, edge, packageMap, violations) {
  const isBareInternal =
    (specifier.startsWith("@platform/") && !specifier.slice("@platform/".length).includes("/")) ||
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
}

function checkUnlistedPlatformImport(fileInfo, specifier, edge, violations) {
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
    violations.push(
      makeViolation(
        fileInfo,
        specifier,
        edge,
        "no-unlisted-platform-import",
        `${fileInfo.packageName} must not import ${targetPackage} (not in architecture.relations.dependsOn)`
      )
    );
  }
}

function checkStrictViolations(
  fileInfo,
  specifier,
  edge,
  { strict, packageMap, resolver, tsConfigPaths },
  violations
) {
  if (!strict) return;

  if (packageMap !== null) {
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

  if (
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

  // Asset imports (.css, .svg, .png, etc.) are resolved by Vite/bundler at
  // build time; TypeScript's module resolver returns null for them. Skip the
  // unresolved check so CSS/asset side-effect imports are not flagged.
  const ASSET_EXTENSIONS =
    /\.(css|scss|sass|less|svg|png|jpg|jpeg|gif|ico|webp|woff|woff2|ttf|eot)$/i;
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    edge?.resolutionStatus === "unresolved" &&
    !ASSET_EXTENSIONS.test(specifier)
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

function checkFileViolations(
  fileInfo,
  { strict, packageMap, resolver, tsConfigPaths },
  violations
) {
  if (strict) checkComputedImports(fileInfo, violations);

  const edgeMap = new Map();
  for (const edge of fileInfo.importEdges) {
    if (!edgeMap.has(edge.specifier)) edgeMap.set(edge.specifier, edge);
  }

  for (const specifier of fileInfo.imports) {
    const edge = edgeMap.get(specifier);
    checkUniversalRules(fileInfo, specifier, edge, violations);
    checkPackageRules(fileInfo, specifier, edge, violations);
    checkSubpathImport(fileInfo, specifier, edge, packageMap, violations);
    checkUnexportedPackageEntry(fileInfo, specifier, edge, packageMap, violations);
    checkUnlistedPlatformImport(fileInfo, specifier, edge, violations);
    checkStrictViolations(
      fileInfo,
      specifier,
      edge,
      { strict, packageMap, resolver, tsConfigPaths },
      violations
    );
  }
}

function checkViolations(files, { strict = false, packageMap = null, resolver = null } = {}) {
  const tsConfigPaths = resolver?.tsConfigPaths ?? [];
  const violations = [];
  for (const fileInfo of files) {
    checkFileViolations(fileInfo, { strict, packageMap, resolver, tsConfigPaths }, violations);
  }
  return violations;
}

function accumulateEdge(edge, counters) {
  counters.totalImports++;
  if (edge.resolutionStatus === "resolved") {
    counters.totalResolvedImports++;
    if (!edge.isExternal) counters.totalInternalEdges++;
    else counters.totalExternalEdges++;
  } else {
    counters.totalUnresolvedImports++;
  }
  if (edge.isTypeOnly) counters.totalTypeOnlyEdges++;
  if (edge.isDynamic) counters.totalDynamicImports++;
}

function computeEdgeStats(files) {
  const counters = {
    totalImports: 0,
    totalResolvedImports: 0,
    totalUnresolvedImports: 0,
    totalInternalEdges: 0,
    totalExternalEdges: 0,
    totalTypeOnlyEdges: 0,
    totalDynamicImports: 0,
  };

  for (const fileInfo of files) {
    for (const edge of fileInfo.importEdges) {
      accumulateEdge(edge, counters);
    }
  }

  return counters;
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
