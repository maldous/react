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
  writeSelfEvidence
} from "./reporter.mjs";

function parseArgs(argv) {
  const options = {
    root: null,
    format: "text",
    noReports: false,
    write: false,
    strict: false,
    tsconfig: null,
    roots: []
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
    const pkg = JSON.parse(fs.readFileSync(
      path.join(repoRoot, "tools", "architecture", "validate-source-imports", "package.json"),
      "utf8"
    ));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function resolveRelativeSpecifier(fileInfo, specifier) {
  const extensions = [".ts", ".tsx", ".js", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js"];
  const base = path.resolve(path.dirname(fileInfo.file), specifier);
  if (fs.existsSync(base)) return true;
  for (const ext of extensions) {
    if (fs.existsSync(base + ext)) return true;
  }
  return false;
}

function buildPackageGraph(files) {
  const graph = new Map();
  for (const fileInfo of files) {
    if (!graph.has(fileInfo.packageName)) graph.set(fileInfo.packageName, new Set());
    for (const specifier of fileInfo.imports) {
      if (specifier.startsWith("@platform/") && !specifier.slice("@platform/".length).includes("/")) {
        graph.get(fileInfo.packageName).add(specifier);
      }
    }
  }
  return graph;
}

function detectCycles(graph) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  for (const node of graph.keys()) color.set(node, WHITE);
  const cycles = [];

  function dfs(node, stack) {
    color.set(node, GRAY);
    stack.push(node);
    for (const dep of (graph.get(node) ?? new Set())) {
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

function checkCycleViolations(files) {
  const graph = buildPackageGraph(files);
  const cycles = detectCycles(graph);
  return cycles.map((cycle) => {
    const packageName = cycle[0];
    const rep = files.find((f) => f.packageName === packageName);
    return {
      file: rep?.file ?? packageName,
      packageName,
      specifier: cycle[cycle.length - 1],
      rule: "no-package-cycle",
      message: `Package cycle detected: ${cycle.join(" → ")}`
    };
  });
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
          message: `${fileInfo.packageName}: computed dynamic import at line ${ci.line} cannot be statically verified`
        });
      }
    }

    for (const specifier of fileInfo.imports) {
      for (const rule of UNIVERSAL_RULES) {
        if (rule.productionOnly && fileInfo.isTestFile) continue;
        if (rule.match(specifier, fileInfo)) {
          violations.push({
            file: fileInfo.file,
            packageName: fileInfo.packageName,
            specifier,
            rule: rule.id,
            message: rule.message(fileInfo.packageName, specifier)
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
              message: rule.message(fileInfo.packageName, specifier)
            });
          }
        }
      }

      if (
        specifier.startsWith("@platform/") &&
        !specifier.slice("@platform/".length).includes("/") &&
        fileInfo.allowedPlatformDeps !== null &&
        !fileInfo.allowedPlatformDeps.includes(specifier)
      ) {
        violations.push({
          file: fileInfo.file,
          packageName: fileInfo.packageName,
          specifier,
          rule: "no-unlisted-platform-import",
          message: `${fileInfo.packageName} must not import ${specifier} (not in architecture.relations.dependsOn)`
        });
      }

      // Strict: @platform/* and @architecture/* imports must resolve to a known package
      if (strict && packageMap !== null) {
        const isPlatform =
          specifier.startsWith("@platform/") &&
          !specifier.slice("@platform/".length).includes("/");
        const isArchitecture =
          specifier.startsWith("@architecture/") &&
          !specifier.slice("@architecture/".length).includes("/");
        if ((isPlatform || isArchitecture) && !packageMap.has(specifier)) {
          violations.push({
            file: fileInfo.file,
            packageName: fileInfo.packageName,
            specifier,
            rule: "no-unresolved-platform-import",
            message: `${fileInfo.packageName} imports ${specifier} which does not exist in the repository`
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
        const { resolvedFile } = resolver.resolve(specifier, fileInfo.file);
        if (!resolvedFile) {
          violations.push({
            file: fileInfo.file,
            packageName: fileInfo.packageName,
            specifier,
            rule: "no-unresolved-alias",
            message: `${fileInfo.packageName}: tsconfig path alias ${specifier} does not resolve to an existing file`
          });
        }
      }

      // Strict: relative imports must resolve to an existing file
      if (
        strict &&
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !resolveRelativeSpecifier(fileInfo, specifier)
      ) {
        violations.push({
          file: fileInfo.file,
          packageName: fileInfo.packageName,
          specifier,
          rule: "no-unresolved-relative-import",
          message: `${fileInfo.packageName}: relative import ${specifier} does not resolve to an existing file`
        });
      }
    }
  }

  return violations;
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
  const violations = checkViolations(files, { strict: OPTIONS.strict, packageMap, resolver });
  if (OPTIONS.strict) violations.push(...checkCycleViolations(files));

  const finishedAt = new Date().toISOString();
  const exitCode = violations.length > 0 ? 1 : 0;

  const jsonReport = buildJsonReport({ generatedAt: finishedAt, files, violations, repoRoot: REPO_ROOT });
  const markdownReport = buildMarkdownReport(jsonReport);

  const outputPaths = [];

  if (!OPTIONS.noReports) {
    const { jsonPath, mdPath } = writeReports(jsonReport, markdownReport, REPORT_DIR);
    outputPaths.push({ label: "JSON report", filePath: jsonPath });
    outputPaths.push({ label: "Markdown report", filePath: mdPath });
  }

  if (OPTIONS.write) {
    const { jsonPath, mdPath } = writeCommittedEvidence(jsonReport, REPO_ROOT, toolVersion, scanRootArgs);
    outputPaths.push({ label: "Evidence JSON", filePath: jsonPath });
    outputPaths.push({ label: "Evidence Markdown", filePath: mdPath });
  }

  let selfEvidencePath = null;
  if (!OPTIONS.noReports) {
    selfEvidencePath = writeSelfEvidence({
      toolName: "validate-source-imports",
      toolVersion,
      command: ["node", "tools/architecture/validate-source-imports/src/index.mjs", ...process.argv.slice(2)],
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
      toolingReportDir: TOOLING_REPORT_DIR
    });
  }

  if (OPTIONS.format === "json") {
    console.log(JSON.stringify({
      toolName: "validate-source-imports",
      totalFiles: jsonReport.totalFiles,
      totalImports: jsonReport.totalImports,
      passed: jsonReport.passed,
      failed: jsonReport.failed,
      violations: jsonReport.violations,
      outputPaths: outputPaths.map((o) => path.relative(REPO_ROOT, o.filePath)),
      selfEvidencePath: selfEvidencePath ? path.relative(REPO_ROOT, selfEvidencePath) : null,
      exitCode
    }, null, 2));
  } else {
    printText(jsonReport, outputPaths, selfEvidencePath, REPO_ROOT);
  }

  process.exit(exitCode);
}

try {
  main();
} catch (error) {
  if (process.argv.includes("--format") && process.argv[process.argv.indexOf("--format") + 1] === "json") {
    console.log(JSON.stringify({ toolName: "validate-source-imports", error: error.message, exitCode: 1 }, null, 2));
  } else {
    console.error(error.message);
  }
  process.exit(1);
}
