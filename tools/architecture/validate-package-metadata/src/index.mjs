#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const options = {
    root: null,
    format: "text",
    noReports: false,
    strict: false,
    allowMissingAjv: false,
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

    if (arg === "--strict") {
      options.strict = true;
      continue;
    }

    if (arg === "--allow-missing-ajv") {
      options.allowMissingAjv = true;
      continue;
    }

    if (arg === "--check") {
      continue;
    }

    if (arg === "--write") {
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

const OPTIONS = parseArgs(process.argv.slice(2));
const REPO_ROOT = findRepoRoot(OPTIONS.root ? path.resolve(OPTIONS.root) : process.cwd());
const SCHEMA_PATH = path.join(REPO_ROOT, "docs", "schemas", "package-json-architecture.schema.json");
const REPORT_DIR = path.join(REPO_ROOT, "reports", "validation");
const TOOLING_REPORT_DIR = path.join(REPO_ROOT, "reports", "tooling", "validate-package-metadata");
const JSON_REPORT = path.join(REPORT_DIR, "package-metadata-validation.json");
const MARKDOWN_REPORT = path.join(REPORT_DIR, "package-metadata-validation.md");

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function loadAjv() {
  // Draft-2020-12 requires Ajv2020, not the default Ajv class
  const candidates = [
    () => import("ajv/dist/2020"),
    () => {
      const local = path.join(REPO_ROOT, "tools", "architecture", "validate-package-metadata", "node_modules", "ajv", "dist", "2020.js");
      return fs.existsSync(local) ? import(pathToFileURL(local).href) : Promise.reject();
    }
  ];
  for (const load of candidates) {
    try {
      const module = await load();
      return module.default ?? module;
    } catch {
      // try next candidate
    }
  }
  return null;
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
    walk(absoluteRoot);
  }

  return [...new Set(results)].sort();

  function isTestFixtureDirectory(directoryPath) {
    const parts = directoryPath.split(path.sep);
    return parts.includes("tests") && parts.includes("fixtures");
  }

  function walk(current) {
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      const base = path.basename(current);
      if (ignored.has(base)) {
        return;
      }
      if (!explicitFixtureScan && isTestFixtureDirectory(current)) {
        return;
      }
      for (const entry of fs.readdirSync(current)) {
        walk(path.join(current, entry));
      }
      return;
    }

    if (path.basename(current) === "package.json") {
      results.push(current);
    }
  }
}

function enumError(pathLabel, value, allowed) {
  if (!allowed.includes(value)) {
    return `${pathLabel} must be one of ${allowed.join(", ")}`;
  }
  return null;
}

function formatAjvError(error) {
  const pathLabel = error.instancePath ? error.instancePath.replaceAll("/", ".").replace(/^\./, "") : "(root)";
  return `schema:${pathLabel} ${error.message}`;
}

function validatePackage(packageJson, packagePath, schemaValidator) {
  const errors = [];
  const warnings = [];

  if (schemaValidator?.validate) {
    const schemaValid = schemaValidator.validate(packageJson);
    if (!schemaValid) {
      for (const error of schemaValidator.validate.errors ?? []) {
        errors.push(formatAjvError(error));
      }
    }
  } else if (schemaValidator?.missingAjv) {
    const message = "Ajv JSON Schema validation dependency is unavailable";
    if (OPTIONS.allowMissingAjv) {
      warnings.push(message);
    } else {
      errors.push(message);
    }
  }

  for (const field of ["name", "version", "description", "private", "type", "exports", "architecture"]) {
    if (!(field in packageJson)) {
      errors.push(`Missing required package field: ${field}`);
    }
  }

  const architecture = packageJson.architecture;
  if (!isObject(architecture)) {
    errors.push("Missing or invalid architecture object");
    return { packagePath, packageName: packageJson.name ?? "(unknown)", valid: false, errors, warnings };
  }

  for (const group of ["schemaVersion", "component", "lifecycle", "governance", "runtime", "boundaries", "relations", "tags", "readme"]) {
    if (!(group in architecture)) {
      errors.push(`Missing architecture.${group}`);
    }
  }

  if (architecture.schemaVersion !== "1.0") {
    errors.push("architecture.schemaVersion must be 1.0");
  }

  validateComponent(architecture.component, errors);
  validateLifecycle(architecture.lifecycle, errors);
  validateGovernance(architecture.governance, errors);
  validateLifecycleGovernanceConsistency(architecture.lifecycle, architecture.governance, errors);
  validateRuntime(architecture.runtime, errors);
  validateBoundaries(architecture.boundaries, errors);
  validateRelations(architecture.relations, errors);
  validateTags(architecture.tags, errors);
  validateReadme(architecture.readme, errors);

  return {
    packagePath,
    packageName: packageJson.name ?? "(unknown)",
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function validateLifecycleGovernanceConsistency(lifecycle, governance, errors) {
  if (!isObject(lifecycle) || !isObject(governance)) return;

  if (lifecycle.stage === "deprecated") {
    if (governance.promotionEligible === true) {
      errors.push("architecture.governance.promotionEligible must be false for deprecated lifecycle stage");
    }
    if (governance.changeControl !== "deprecation-review") {
      errors.push("architecture.governance.changeControl must be deprecation-review for deprecated lifecycle stage");
    }
    if (governance.semverPolicy !== "deprecated") {
      errors.push("architecture.governance.semverPolicy must be deprecated for deprecated lifecycle stage");
    }
  }

  if (lifecycle.stage === "external") {
    if (!["semver-required", "external-governed"].includes(governance.semverPolicy)) {
      errors.push("architecture.governance.semverPolicy must be semver-required or external-governed for external lifecycle stage");
    }
  }
}

function validateComponent(component, errors) {
  if (!isObject(component)) {
    errors.push("architecture.component must be an object");
    return;
  }

  for (const field of ["type", "name", "system", "domain", "boundedContext", "owner"]) {
    if (!component[field]) {
      errors.push(`architecture.component.${field} is required`);
    }
  }

  const typeError = enumError("architecture.component.type", component.type, [
    "application", "library", "service", "api", "worker", "tool", "test", "documentation"
  ]);
  if (typeError) errors.push(typeError);
}

function validateLifecycle(lifecycle, errors) {
  if (!isObject(lifecycle)) {
    errors.push("architecture.lifecycle must be an object");
    return;
  }

  const stages = ["experimental", "candidate", "active", "stable", "maintenance", "external", "deprecated"];
  const roles = ["feature", "platform", "contract", "adapter", "tooling", "test"];

  const stageError = enumError("architecture.lifecycle.stage", lifecycle.stage, stages);
  if (stageError) errors.push(stageError);

  const roleError = enumError("architecture.lifecycle.role", lifecycle.role, roles);
  if (roleError) errors.push(roleError);

  const expectedClass = `${lifecycle.stage}.${lifecycle.role}`;
  if (lifecycle.class !== expectedClass) {
    errors.push(`architecture.lifecycle.class must equal ${expectedClass}`);
  }

  const expectedCatalogLifecycle = ["experimental", "candidate"].includes(lifecycle.stage)
    ? "experimental"
    : lifecycle.stage === "deprecated"
      ? "deprecated"
      : "production";

  if (lifecycle.catalogLifecycle !== expectedCatalogLifecycle) {
    errors.push(`architecture.lifecycle.catalogLifecycle must equal ${expectedCatalogLifecycle} for stage ${lifecycle.stage}`);
  }

  if (lifecycle.stage === "external" && lifecycle.visibility !== "external") {
    errors.push("architecture.lifecycle.visibility must be external for external lifecycle stage");
  }

  if (lifecycle.stage === "deprecated") {
    if (lifecycle.visibility !== "deprecated") {
      errors.push("architecture.lifecycle.visibility must be deprecated for deprecated lifecycle stage");
    }
    if (!["deprecated", "unsupported"].includes(lifecycle.supportLevel)) {
      errors.push("architecture.lifecycle.supportLevel must be deprecated or unsupported for deprecated lifecycle stage");
    }
  }
}

function validateGovernance(governance, errors) {
  if (!isObject(governance)) {
    errors.push("architecture.governance must be an object");
    return;
  }

  if (!Array.isArray(governance.decisionRefs) || governance.decisionRefs.length === 0) {
    errors.push("architecture.governance.decisionRefs must be a non-empty array");
  } else {
    for (const ref of governance.decisionRefs) {
      if (typeof ref !== "string" || !/^ADR-\d{4}$/.test(ref)) {
        errors.push(`architecture.governance.decisionRefs contains invalid ADR reference: ${ref}`);
      }
    }
  }

  const semverError = enumError("architecture.governance.semverPolicy", governance.semverPolicy, [
    "none", "internal-traceable", "compatibility-reviewed", "semver-required", "external-governed", "deprecated"
  ]);
  if (semverError) errors.push(semverError);

  const changeControlError = enumError("architecture.governance.changeControl", governance.changeControl, [
    "none", "owner-review", "architecture-review", "security-review", "release-review", "deprecation-review"
  ]);
  if (changeControlError) errors.push(changeControlError);

  if (typeof governance.promotionEligible !== "boolean") {
    errors.push("architecture.governance.promotionEligible must be boolean");
  }
}

function validateRuntime(runtime, errors) {
  if (!isObject(runtime)) {
    errors.push("architecture.runtime must be an object");
    return;
  }

  if (runtime.production === true && runtime.testOnly === true) {
    errors.push("architecture.runtime.production and architecture.runtime.testOnly cannot both be true");
  }

  for (const field of ["serviceName", "serviceNamespace"]) {
    if (!runtime[field]) {
      errors.push(`architecture.runtime.${field} is required`);
    }
  }

  if (!Array.isArray(runtime.deploymentEnvironments)) {
    errors.push("architecture.runtime.deploymentEnvironments must be an array");
  }
}

function validateBoundaries(boundaries, errors) {
  if (!isObject(boundaries)) {
    errors.push("architecture.boundaries must be an object");
    return;
  }

  if (boundaries.publicExportsOnly === true && boundaries.deepImportsAllowed === true) {
    errors.push("architecture.boundaries.deepImportsAllowed must be false when publicExportsOnly is true");
  }

  for (const field of ["allowedConsumers", "forbiddenConsumers"]) {
    if (!Array.isArray(boundaries[field])) {
      errors.push(`architecture.boundaries.${field} must be an array`);
    }
  }
}

function validateRelations(relations, errors) {
  if (!isObject(relations)) {
    errors.push("architecture.relations must be an object");
    return;
  }

  for (const field of ["dependsOn", "providesApis", "consumesApis"]) {
    if (!Array.isArray(relations[field])) {
      errors.push(`architecture.relations.${field} must be an array`);
    }
  }
}

function validateTags(tags, errors) {
  if (!isObject(tags)) {
    errors.push("architecture.tags must be an object");
    return;
  }

  for (const field of ["scope", "type", "stage", "role", "layer"]) {
    if (!tags[field]) {
      errors.push(`architecture.tags.${field} is required`);
    }
  }
}

function validateReadme(readme, errors) {
  if (!isObject(readme)) {
    errors.push("architecture.readme must be an object");
    return;
  }

  if (readme.generated !== true) {
    errors.push("architecture.readme.generated must be true");
  }

  if (!readme.summary) {
    errors.push("architecture.readme.summary is required");
  }

  for (const field of ["responsibilities", "nonResponsibilities", "usage", "operationalNotes"]) {
    if (!Array.isArray(readme[field])) {
      errors.push(`architecture.readme.${field} must be an array`);
    }
  }
}

async function createSchemaValidator(schema) {
  const Ajv = await loadAjv();
  if (!Ajv) {
    return {
      missingAjv: true,
      validatorName: "ajv",
      validatorAvailable: false
    };
  }

  const ajv = new Ajv({
    allErrors: true,
    strict: false
  });

  return {
    missingAjv: false,
    validatorName: "ajv",
    validatorAvailable: true,
    validate: ajv.compile(schema)
  };
}

function buildReports(results, startedAt, finishedAt, schemaValidator) {
  const passed = results.filter((result) => result.valid).length;
  const failed = results.length - passed;

  const jsonReport = {
    generatedAt: finishedAt,
    schemaPath: path.relative(REPO_ROOT, SCHEMA_PATH),
    schemaValidator: {
      name: schemaValidator.validatorName,
      available: schemaValidator.validatorAvailable,
      missingAllowed: OPTIONS.allowMissingAjv
    },
    totalPackages: results.length,
    passed,
    failed,
    results: results.map((result) => ({
      ...result,
      packagePath: path.relative(REPO_ROOT, result.packagePath)
    }))
  };

  const lines = [
    "# Package metadata validation report",
    "",
    `Generated at: ${jsonReport.generatedAt}`,
    "",
    "## Summary",
    "",
    "```text",
    `Total packages: ${results.length}`,
    `Passed: ${passed}`,
    `Failed: ${failed}`,
    `Schema validator: ${schemaValidator.validatorName}`,
    `Schema validator available: ${schemaValidator.validatorAvailable}`,
    "```",
    "",
    "## Results",
    ""
  ];

  for (const result of jsonReport.results) {
    lines.push(`### ${result.packageName}`);
    lines.push("");
    lines.push("```text");
    lines.push(`Path: ${result.packagePath}`);
    lines.push(`Status: ${result.valid ? "PASS" : "FAIL"}`);
    lines.push("```");
    lines.push("");

    if (result.errors.length > 0) {
      lines.push("Errors:");
      lines.push("");
      for (const error of result.errors) {
        lines.push(`- ${error}`);
      }
      lines.push("");
    }

    if (result.warnings.length > 0) {
      lines.push("Warnings:");
      lines.push("");
      for (const warning of result.warnings) {
        lines.push(`- ${warning}`);
      }
      lines.push("");
    }
  }

  return {
    passed,
    failed,
    jsonReport,
    markdownReport: `${lines.join("\n")}\n`,
    startedAt,
    finishedAt
  };
}

function writeReports(report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report.jsonReport, null, 2)}\n`, "utf8");
  fs.writeFileSync(MARKDOWN_REPORT, report.markdownReport, "utf8");
  return { jsonReportPath: JSON_REPORT, markdownReportPath: MARKDOWN_REPORT };
}

function writeSelfEvidence({ report, startedAt, finishedAt, command, roots, outputPaths, exitCode }) {
  if (OPTIONS.noReports) {
    return null;
  }

  fs.mkdirSync(TOOLING_REPORT_DIR, { recursive: true });
  const safeTimestamp = finishedAt.replace(/[:.]/g, "-");
  const evidencePath = path.join(TOOLING_REPORT_DIR, `${safeTimestamp}-run.json`);
  const evidence = {
    toolName: "validate-package-metadata",
    toolVersion: readJson(path.join(REPO_ROOT, "tools", "architecture", "validate-package-metadata", "package.json")).version ?? "0.0.0",
    command,
    mode: "check",
    root: REPO_ROOT,
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    inputRoots: roots,
    outputPaths,
    rulesEvaluated: [
      "Ajv JSON Schema validation",
      "package required fields",
      "architecture metadata groups",
      "lifecycle enum rules",
      "lifecycle class semantic rule",
      "lifecycle-governance consistency rules (skeleton-phase exception: initial packages are exempt from transition evidence requirements per ADR-ACT-0077)",
      "governance ADR reference format",
      "runtime production/testOnly semantic rule",
      "boundary deep import semantic rule",
      "relations array rules",
      "readme metadata rules"
    ],
    checksPassed: report.passed,
    checksFailed: report.failed,
    warnings: report.jsonReport.results.flatMap((result) => result.warnings.map((message) => ({
      packageName: result.packageName,
      packagePath: result.packagePath,
      message
    }))),
    errors: report.jsonReport.results.flatMap((result) => result.errors.map((message) => ({
      packageName: result.packageName,
      packagePath: result.packagePath,
      message
    }))),
    dependencySteps: [],
    schemaValidator: report.jsonReport.schemaValidator,
    gitTreatment: "reports/** ignored by default",
    exitCode
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return evidencePath;
}

function printTextSummary(report, outputPaths, selfEvidencePath) {
  console.log(`Validated ${report.jsonReport.totalPackages} package.json file(s).`);
  console.log(`Passed: ${report.passed}`);
  console.log(`Failed: ${report.failed}`);
  console.log(`Schema validator: ${report.jsonReport.schemaValidator.name}`);
  console.log(`Schema validator available: ${report.jsonReport.schemaValidator.available}`);
  for (const outputPath of outputPaths) {
    console.log(`${outputPath.label}: ${path.relative(REPO_ROOT, outputPath.path)}`);
  }
  if (selfEvidencePath) {
    console.log(`Self-evidence: ${path.relative(REPO_ROOT, selfEvidencePath)}`);
  }
}

async function main() {
  const startedAt = new Date().toISOString();

  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error(`Schema not found: ${SCHEMA_PATH}`);
    process.exit(1);
  }

  const schema = readJson(SCHEMA_PATH);
  const schemaValidator = await createSchemaValidator(schema);

  const roots = OPTIONS.roots.length > 0 ? OPTIONS.roots : ["apps", "packages", "tools/architecture"];
  const packageFiles = listPackageJsonFiles(roots);
  const results = [];

  for (const packageFile of packageFiles) {
    try {
      const packageJson = readJson(packageFile);
      results.push(validatePackage(packageJson, packageFile, schemaValidator));
    } catch (error) {
      results.push({
        packagePath: packageFile,
        packageName: "(unreadable)",
        valid: false,
        errors: [error.message],
        warnings: []
      });
    }
  }

  const finishedAt = new Date().toISOString();
  const report = buildReports(results, startedAt, finishedAt, schemaValidator);
  const exitCode = report.failed === 0 ? 0 : 1;
  const outputPaths = [];

  if (!OPTIONS.noReports) {
    const written = writeReports(report);
    outputPaths.push({ label: "JSON report", path: written.jsonReportPath });
    outputPaths.push({ label: "Markdown report", path: written.markdownReportPath });
  }

  const selfEvidencePath = writeSelfEvidence({
    report,
    startedAt,
    finishedAt,
    command: ["node", "tools/architecture/validate-package-metadata/src/index.mjs", ...process.argv.slice(2)],
    roots,
    outputPaths: outputPaths.map((outputPath) => path.relative(REPO_ROOT, outputPath.path)),
    exitCode
  });

  if (OPTIONS.format === "json") {
    console.log(JSON.stringify({
      toolName: "validate-package-metadata",
      totalPackages: report.jsonReport.totalPackages,
      passed: report.passed,
      failed: report.failed,
      schemaValidator: report.jsonReport.schemaValidator,
      outputPaths: outputPaths.map((outputPath) => path.relative(REPO_ROOT, outputPath.path)),
      selfEvidencePath: selfEvidencePath ? path.relative(REPO_ROOT, selfEvidencePath) : null,
      exitCode
    }, null, 2));
  } else {
    printTextSummary(report, outputPaths, selfEvidencePath);
  }

  process.exit(exitCode);
}

try {
  await main();
} catch (error) {
  if (OPTIONS.format === "json") {
    console.log(JSON.stringify({ toolName: "validate-package-metadata", error: error.message, exitCode: 1 }, null, 2));
  } else {
    console.error(error.message);
  }
  process.exit(1);
}
