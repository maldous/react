#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { findRepoRoot as sharedFindRepoRoot } from "../../_shared/repo-root.mjs";
import { readJson } from "../../_shared/json.mjs";
import { walkPackageJson } from "../../_shared/files.mjs";
import { writeSelfEvidence as sharedWriteSelfEvidence } from "../../_shared/self-evidence.mjs";

function parseArgs(argv) {
  const options = {
    root: null,
    format: "text",
    noReports: false,
    write: false,
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
    } else if (arg === "--write") {
      options.write = true;
      i += 1;
    } else if (arg === "--check") {
      options.write = false;
      i += 1;
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

const OPTIONS = parseArgs(process.argv.slice(2));
const REPO_ROOT = findRepoRoot(OPTIONS.root ? path.resolve(OPTIONS.root) : process.cwd());
const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOL_PACKAGE_PATH = path.join(TOOL_ROOT, "package.json");

const INVENTORY_JSON = path.join(
  REPO_ROOT,
  "reports",
  "package-inventory",
  "package-inventory.json"
);
const INVENTORY_MD = path.join(REPO_ROOT, "reports", "package-inventory", "package-inventory.md");
const LIFECYCLE_JSON = path.join(
  REPO_ROOT,
  "reports",
  "lifecycle",
  "package-lifecycle-summary.json"
);
const LIFECYCLE_MD = path.join(REPO_ROOT, "reports", "lifecycle", "package-lifecycle-summary.md");
const TOOLING_REPORT_DIR = path.join(REPO_ROOT, "reports", "tooling", "generate-package-inventory");

function findRepoRoot(startDir) {
  return sharedFindRepoRoot(startDir, "docs/schemas/package-json-architecture.schema.json");
}

function isInventoryFixtureDirectory(directoryPath) {
  const relativeParts = path.relative(REPO_ROOT, directoryPath).split(path.sep);
  return relativeParts.includes("tests") && relativeParts.includes("fixtures");
}

function listPackageJsonFiles(searchRoots) {
  const ignored = new Set(["node_modules", ".git", "dist", "build", "coverage", "reports"]);
  const results = [];
  const explicitFixtureScan = searchRoots.some((root) => root.split(/[\\/]/).includes("fixtures"));

  for (const root of searchRoots) {
    const absoluteRoot = path.resolve(REPO_ROOT, root);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }
    walkPackageJson(absoluteRoot, results, {
      ignored,
      isFixtureDir: isInventoryFixtureDirectory,
      explicitFixtureScan,
    });
  }

  return [...new Set(results)].sort();
}

function packageRecord(packageFile) {
  const packageJson = readJson(packageFile);
  const a = packageJson.architecture;
  if (!a) return null;

  return {
    name: packageJson.name,
    version: packageJson.version,
    path: path.relative(REPO_ROOT, packageFile),
    component: {
      name: a.component?.name,
      type: a.component?.type,
      system: a.component?.system,
      domain: a.component?.domain,
      boundedContext: a.component?.boundedContext,
      owner: a.component?.owner,
    },
    lifecycle: {
      stage: a.lifecycle?.stage,
      role: a.lifecycle?.role,
      class: a.lifecycle?.class,
      catalogLifecycle: a.lifecycle?.catalogLifecycle,
      visibility: a.lifecycle?.visibility,
      supportLevel: a.lifecycle?.supportLevel,
      reviewCadence: a.lifecycle?.reviewCadence,
    },
    governance: {
      decisionRefs: a.governance?.decisionRefs ?? [],
      semverPolicy: a.governance?.semverPolicy,
      changeControl: a.governance?.changeControl,
      promotionEligible: a.governance?.promotionEligible,
    },
    runtime: {
      production: a.runtime?.production,
      testOnly: a.runtime?.testOnly,
      serviceName: a.runtime?.serviceName,
      serviceNamespace: a.runtime?.serviceNamespace,
      deploymentEnvironments: a.runtime?.deploymentEnvironments ?? [],
    },
    relations: {
      dependsOn: a.relations?.dependsOn ?? [],
      providesApis: a.relations?.providesApis ?? [],
      consumesApis: a.relations?.consumesApis ?? [],
    },
    tags: a.tags ?? {},
  };
}

function buildInventory(records, generatedAt) {
  return {
    generatedAt,
    source: "package.json architecture metadata",
    totalPackages: records.length,
    packages: records,
  };
}

function countBy(records, fieldGetter) {
  const counts = {};
  for (const record of records) {
    const key = fieldGetter(record) ?? "(missing)";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function buildLifecycleSummary(records, generatedAt) {
  return {
    generatedAt,
    source: "package.json architecture metadata",
    totalPackages: records.length,
    byStage: countBy(records, (record) => record.lifecycle.stage),
    byRole: countBy(records, (record) => record.lifecycle.role),
    byClass: countBy(records, (record) => record.lifecycle.class),
    bySupportLevel: countBy(records, (record) => record.lifecycle.supportLevel),
    packages: records.map((record) => ({
      name: record.name,
      path: record.path,
      lifecycle: record.lifecycle,
      owner: record.component.owner,
      changeControl: record.governance.changeControl,
      promotionEligible: record.governance.promotionEligible,
    })),
  };
}

function table(rows, headers) {
  const lines = [];
  lines.push(`| ${headers.join(" |")} |`);
  lines.push(`| ${headers.map(() => "---").join(" |")} |`);
  for (const row of rows) {
    lines.push(`| ${headers.map((header) => String(row[header] ?? "")).join(" |")} |`);
  }
  return lines.join("\n");
}

function renderInventoryMarkdown(inventory) {
  const rows = inventory.packages.map((record) => ({
    Package: record.name,
    Type: record.component.type,
    Domain: record.component.domain,
    Context: record.component.boundedContext,
    Lifecycle: record.lifecycle.class,
    Owner: record.component.owner,
    Path: record.path,
  }));

  return `# Package inventory report

Generated at: ${inventory.generatedAt}

## Summary

\`\`\`text
Total packages: ${inventory.totalPackages}
Source: ${inventory.source}
\`\`\`

## Packages

${table(rows, ["Package", "Type", "Domain", "Context", "Lifecycle", "Owner", "Path"])}

`;
}

function renderLifecycleMarkdown(summary) {
  const stageRows = Object.entries(summary.byStage).map(([Stage, Count]) => ({ Stage, Count }));
  const roleRows = Object.entries(summary.byRole).map(([Role, Count]) => ({ Role, Count }));
  const classRows = Object.entries(summary.byClass).map(([Class, Count]) => ({ Class, Count }));
  const packageRows = summary.packages.map((record) => ({
    Package: record.name,
    Stage: record.lifecycle.stage,
    Role: record.lifecycle.role,
    Class: record.lifecycle.class,
    Support: record.lifecycle.supportLevel,
    Owner: record.owner,
    Path: record.path,
  }));

  return `# Package lifecycle summary report

Generated at: ${summary.generatedAt}

## Summary

\`\`\`text
Total packages: ${summary.totalPackages}
Source: ${summary.source}
\`\`\`

## By stage

${table(stageRows, ["Stage", "Count"])}

## By role

${table(roleRows, ["Role", "Count"])}

## By class

${table(classRows, ["Class", "Count"])}

## Packages

${table(packageRows, ["Package", "Stage", "Role", "Class", "Support", "Owner", "Path"])}

`;
}

function buildOutputs(records, generatedAt) {
  const inventory = buildInventory(records, generatedAt);
  const lifecycle = buildLifecycleSummary(records, generatedAt);
  return {
    [INVENTORY_JSON]: `${JSON.stringify(inventory, null, 2)}\n`,
    [INVENTORY_MD]: renderInventoryMarkdown(inventory),
    [LIFECYCLE_JSON]: `${JSON.stringify(lifecycle, null, 2)}\n`,
    [LIFECYCLE_MD]: renderLifecycleMarkdown(lifecycle),
  };
}

function compareOutputs(outputs) {
  return Object.entries(outputs).map(([filePath, expected]) => {
    const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
    return {
      path: path.relative(REPO_ROOT, filePath),
      status: current === expected ? "fresh" : "stale",
      changed: current !== expected,
    };
  });
}

function writeOutputs(outputs) {
  for (const [filePath, content] of Object.entries(outputs)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }
}

function writeSelfEvidence({ startedAt, finishedAt, roots, results, exitCode }) {
  if (OPTIONS.noReports) return null;
  const evidence = {
    toolName: "generate-package-inventory",
    toolVersion: readJson(TOOL_PACKAGE_PATH).version ?? "0.0.0",
    command: [
      "node",
      "tools/architecture/generate-package-inventory/src/index.mjs",
      ...process.argv.slice(2),
    ],
    mode: OPTIONS.write ? "write" : "check",
    root: REPO_ROOT,
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    inputRoots: roots,
    outputPaths: results.filter((r) => OPTIONS.write || r.status === "fresh").map((r) => r.path),
    rulesEvaluated: [
      "package inventory JSON output",
      "package inventory Markdown output",
      "lifecycle summary JSON output",
      "lifecycle summary Markdown output",
      "check mode reports stale reports without writing",
      "write mode writes only reports/package-inventory and reports/lifecycle",
    ],
    checksPassed: results.filter((r) => r.status === "fresh" || OPTIONS.write).length,
    checksFailed: OPTIONS.write ? 0 : results.filter((r) => r.status === "stale").length,
    warnings: [],
    errors: OPTIONS.write
      ? []
      : results
          .filter((r) => r.status === "stale")
          .map((r) => ({ path: r.path, message: "generated report is stale or missing" })),
    dependencySteps: [],
    gitTreatment: "reports/** ignored by default",
    exitCode,
  };
  return sharedWriteSelfEvidence({
    evidence,
    toolingReportDir: TOOLING_REPORT_DIR,
    noReports: OPTIONS.noReports,
  });
}

function existingGeneratedAt() {
  if (!fs.existsSync(INVENTORY_JSON)) {
    return null;
  }

  try {
    const existing = readJson(INVENTORY_JSON);
    return existing.generatedAt ?? null;
  } catch {
    return null;
  }
}

function main() {
  const startedAt = new Date().toISOString();
  const generatedAt =
    process.env.ARCHITECTURE_REPORT_GENERATED_AT ??
    (OPTIONS.write ? new Date().toISOString() : existingGeneratedAt()) ??
    new Date().toISOString();
  const roots =
    OPTIONS.roots.length > 0 ? OPTIONS.roots : ["apps", "packages", "tools/architecture"];
  const packageFiles = listPackageJsonFiles(roots);
  const records = packageFiles.map(packageRecord).filter(Boolean);
  const outputs = buildOutputs(records, generatedAt);
  const results = compareOutputs(outputs);

  if (OPTIONS.write) {
    writeOutputs(outputs);
  }

  const stale = OPTIONS.write ? 0 : results.filter((r) => r.status === "stale").length;
  const exitCode = stale > 0 ? 1 : 0;
  const finishedAt = new Date().toISOString();
  const selfEvidencePath = writeSelfEvidence({ startedAt, finishedAt, roots, results, exitCode });

  const summary = {
    toolName: "generate-package-inventory",
    mode: OPTIONS.write ? "write" : "check",
    totalPackages: records.length,
    outputs: results,
    stale,
    written: OPTIONS.write ? results.filter((r) => r.changed).length : 0,
    selfEvidencePath: selfEvidencePath ? path.relative(REPO_ROOT, selfEvidencePath) : null,
    exitCode,
  };

  if (OPTIONS.format === "json") {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Package inventory generation: ${OPTIONS.write ? "write" : "check"}`);
    console.log(`Packages: ${records.length}`);
    console.log(`Stale: ${stale}`);
    console.log(`Written: ${summary.written}`);
    if (selfEvidencePath)
      console.log(`Self-evidence: ${path.relative(REPO_ROOT, selfEvidencePath)}`);
  }

  process.exit(exitCode);
}

try {
  main();
} catch (error) {
  if (OPTIONS.format === "json") {
    console.log(
      JSON.stringify(
        { toolName: "generate-package-inventory", error: error.message, exitCode: 1 },
        null,
        2
      )
    );
  } else {
    console.error(error.message);
  }
  process.exit(1);
}
