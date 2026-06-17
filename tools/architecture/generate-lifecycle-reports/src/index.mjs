#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { findRepoRoot as sharedFindRepoRoot } from "../../_shared/repo-root.mjs";
import { readJson } from "../../_shared/json.mjs";
import { walkPackageJson } from "../../_shared/files.mjs";

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
const GOVERNANCE_JSON = path.join(
  REPO_ROOT,
  "reports",
  "lifecycle",
  "lifecycle-governance-report.json"
);
const GOVERNANCE_MD = path.join(
  REPO_ROOT,
  "reports",
  "lifecycle",
  "lifecycle-governance-report.md"
);
const TOOLING_REPORT_DIR = path.join(REPO_ROOT, "reports", "tooling", "generate-lifecycle-reports");

function findRepoRoot(startDir) {
  return sharedFindRepoRoot(startDir, "docs/schemas/package-json-architecture.schema.json");
}

function isTestFixtureDirectory(directoryPath) {
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
      isFixtureDir: isTestFixtureDirectory,
      explicitFixtureScan,
    });
  }

  return [...new Set(results)].sort();
}

function packageRecord(packageFile) {
  const pkg = readJson(packageFile);
  const a = pkg.architecture;
  if (!a) return null;

  return {
    name: pkg.name,
    path: path.relative(REPO_ROOT, packageFile),
    domain: a.component?.domain ?? "(missing)",
    owner: a.component?.owner ?? "(missing)",
    stage: a.lifecycle?.stage ?? "(missing)",
    role: a.lifecycle?.role ?? "(missing)",
    class: a.lifecycle?.class ?? "(missing)",
    reviewCadence: a.lifecycle?.reviewCadence ?? "(missing)",
    promotionEligible: a.governance?.promotionEligible ?? false,
    changeControl: a.governance?.changeControl ?? "(missing)",
  };
}

function groupBy(records, keyFn) {
  const groups = {};
  for (const record of records) {
    const key = keyFn(record);
    if (!groups[key]) groups[key] = [];
    groups[key].push(record);
  }
  return Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)));
}

function miniRecord(record) {
  return { name: record.name, class: record.class, owner: record.owner };
}

function buildGovernanceReport(records, generatedAt) {
  const byDomainRaw = groupBy(records, (r) => r.domain);
  const byOwnerRaw = groupBy(records, (r) => r.owner);

  return {
    generatedAt,
    source: "package.json architecture metadata",
    totalPackages: records.length,
    promotionEligiblePackages: records
      .filter((r) => r.promotionEligible)
      .map((r) => ({
        name: r.name,
        class: r.class,
        owner: r.owner,
        changeControl: r.changeControl,
      })),
    maintenancePackages: records.filter((r) => r.stage === "maintenance").map(miniRecord),
    deprecatedPackages: records.filter((r) => r.stage === "deprecated").map(miniRecord),
    externalPackages: records.filter((r) => r.stage === "external").map(miniRecord),
    byDomain: Object.fromEntries(
      Object.entries(byDomainRaw).map(([domain, recs]) => [
        domain,
        recs.map((r) => ({ name: r.name, class: r.class })),
      ])
    ),
    byOwner: Object.fromEntries(
      Object.entries(byOwnerRaw).map(([owner, recs]) => [
        owner,
        recs.map((r) => ({ name: r.name, class: r.class })),
      ])
    ),
  };
}

function table(rows, headers) {
  const lines = [];
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    lines.push(`| ${headers.map((h) => String(row[h] ?? "")).join(" | ")} |`);
  }
  return lines.join("\n");
}

function renderGovernanceMarkdown(report) {
  const lines = [
    "# Package lifecycle governance report",
    "",
    "> Generated from package-local package.json architecture metadata. Do not edit this report by hand.",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    "```text",
    `Total packages: ${report.totalPackages}`,
    `Promotion eligible: ${report.promotionEligiblePackages.length}`,
    `Maintenance: ${report.maintenancePackages.length}`,
    `Deprecated: ${report.deprecatedPackages.length}`,
    `External: ${report.externalPackages.length}`,
    "```",
  ];

  if (report.promotionEligiblePackages.length > 0) {
    lines.push("", "## Promotion eligible packages", "");
    lines.push(
      table(report.promotionEligiblePackages, ["name", "class", "owner", "changeControl"])
    );
  }

  if (report.maintenancePackages.length > 0) {
    lines.push("", "## Maintenance packages", "");
    lines.push(table(report.maintenancePackages, ["name", "class", "owner"]));
  }

  if (report.deprecatedPackages.length > 0) {
    lines.push("", "## Deprecated packages", "");
    lines.push(table(report.deprecatedPackages, ["name", "class", "owner"]));
  }

  if (report.externalPackages.length > 0) {
    lines.push("", "## External packages", "");
    lines.push(table(report.externalPackages, ["name", "class", "owner"]));
  }

  lines.push("", "## Packages by domain", "");
  for (const [domain, pkgs] of Object.entries(report.byDomain)) {
    lines.push(`### ${domain}`, "");
    lines.push(table(pkgs, ["name", "class"]));
    lines.push("");
  }

  lines.push("## Packages by owner", "");
  for (const [owner, pkgs] of Object.entries(report.byOwner)) {
    lines.push(`### ${owner}`, "");
    lines.push(table(pkgs, ["name", "class"]));
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function buildOutputs(records, generatedAt) {
  const report = buildGovernanceReport(records, generatedAt);
  return {
    [GOVERNANCE_JSON]: `${JSON.stringify(report, null, 2)}\n`,
    [GOVERNANCE_MD]: renderGovernanceMarkdown(report),
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

function existingGeneratedAt() {
  if (!fs.existsSync(GOVERNANCE_JSON)) return null;
  try {
    return readJson(GOVERNANCE_JSON).generatedAt ?? null;
  } catch {
    return null;
  }
}

function writeSelfEvidence({ startedAt, finishedAt, roots, results, exitCode }) {
  if (OPTIONS.noReports) return null;

  fs.mkdirSync(TOOLING_REPORT_DIR, { recursive: true });
  const safeTimestamp = finishedAt.replace(/[:.]/g, "-");
  const evidencePath = path.join(TOOLING_REPORT_DIR, `${safeTimestamp}-run.json`);
  const evidence = {
    toolName: "generate-lifecycle-reports",
    toolVersion: readJson(TOOL_PACKAGE_PATH).version ?? "0.0.0",
    command: [
      "node",
      "tools/architecture/generate-lifecycle-reports/src/index.mjs",
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
      "lifecycle governance report JSON output",
      "lifecycle governance report Markdown output",
      "check mode reports stale reports without writing",
      "write mode writes only reports/lifecycle/lifecycle-governance-report.*",
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

  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return evidencePath;
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
    toolName: "generate-lifecycle-reports",
    mode: OPTIONS.write ? "write" : "check",
    totalPackages: records.length,
    outputs: results,
    stale,
    written: OPTIONS.write ? Object.keys(outputs).length : 0,
    selfEvidencePath: selfEvidencePath ? path.relative(REPO_ROOT, selfEvidencePath) : null,
    exitCode,
  };

  if (OPTIONS.format === "json") {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Lifecycle governance reports: ${OPTIONS.write ? "write" : "check"}`);
    console.log(`Packages: ${records.length}`);
    console.log(`Stale: ${stale}`);
    console.log(`Written: ${summary.written}`);
    if (selfEvidencePath) {
      console.log(`Self-evidence: ${path.relative(REPO_ROOT, selfEvidencePath)}`);
    }
  }

  process.exit(exitCode);
}

try {
  main();
} catch (error) {
  if (OPTIONS.format === "json") {
    console.log(
      JSON.stringify(
        { toolName: "generate-lifecycle-reports", error: error.message, exitCode: 1 },
        null,
        2
      )
    );
  } else {
    console.error(error.message);
  }
  process.exit(1);
}
