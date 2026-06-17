#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { findRepoRoot as sharedFindRepoRoot } from "../../_shared/repo-root.mjs";
import { readJson } from "../../_shared/json.mjs";
import { walkPackageJson } from "../../_shared/files.mjs";

export function parseArgs(argv) {
  const options = {
    root: null,
    format: "text",
    noReports: false,
    strict: false,
    allowMissingAjv: false,
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
    } else if (arg === "--strict") {
      options.strict = true;
      i += 1;
    } else if (arg === "--allow-missing-ajv") {
      options.allowMissingAjv = true;
      i += 1;
    } else if (arg === "--check" || arg === "--write") {
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

// Marker that identifies this repo's root for this tool (unchanged behaviour).
const REPO_ROOT_MARKER = "docs/schemas/package-json-architecture.schema.json";
export function findRepoRoot(startDir) {
  return sharedFindRepoRoot(startDir, REPO_ROOT_MARKER);
}

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function loadAjv(repoRoot) {
  // Draft-2020-12 requires Ajv2020, not the default Ajv class
  const candidates = [
    () => import("ajv/dist/2020"),
    () => {
      const local = path.join(
        repoRoot,
        "tools",
        "architecture",
        "validate-package-metadata",
        "node_modules",
        "ajv",
        "dist",
        "2020.js"
      );
      return fs.existsSync(local) ? import(pathToFileURL(local).href) : Promise.reject();
    },
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

function isMetadataFixtureDirectory(directoryPath) {
  const parts = directoryPath.split(path.sep);
  return parts.includes("tests") && parts.includes("fixtures");
}

export function listPackageJsonFiles(searchRoots, repoRoot) {
  const ignored = new Set(["node_modules", ".git", "dist", "build", "coverage", "reports"]);
  const results = [];
  const explicitFixtureScan = searchRoots.some((root) => root.split(/[\\/]/).includes("fixtures"));

  for (const root of searchRoots) {
    const absoluteRoot = path.resolve(repoRoot, root);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }
    walkPackageJson(absoluteRoot, results, {
      ignored,
      isFixtureDir: isMetadataFixtureDirectory,
      explicitFixtureScan,
    });
  }

  return [...new Set(results)].sort();
}

function enumError(pathLabel, value, allowed) {
  if (!allowed.includes(value)) {
    return `${pathLabel} must be one of ${allowed.join(", ")}`;
  }
  return null;
}

function formatAjvError(error) {
  const pathLabel = error.instancePath
    ? error.instancePath.replaceAll("/", ".").replace(/^\./, "")
    : "(root)";
  return `schema:${pathLabel} ${error.message}`;
}

const REQUIRED_PACKAGE_FIELDS = [
  "name",
  "version",
  "description",
  "private",
  "type",
  "exports",
  "architecture",
];
export const REQUIRED_ARCHITECTURE_GROUPS = [
  "schemaVersion",
  "component",
  "lifecycle",
  "governance",
  "runtime",
  "boundaries",
  "relations",
  "tags",
  "readme",
];

export function applySchemaValidation(
  packageJson,
  schemaValidator,
  errors,
  warnings,
  allowMissingAjv
) {
  if (schemaValidator?.validate) {
    const schemaValid = schemaValidator.validate(packageJson);
    if (!schemaValid) {
      for (const error of schemaValidator.validate.errors ?? []) {
        errors.push(formatAjvError(error));
      }
    }
  } else if (schemaValidator?.missingAjv) {
    const message = "Ajv JSON Schema validation dependency is unavailable";
    if (allowMissingAjv) {
      warnings.push(message);
    } else {
      errors.push(message);
    }
  }
}

export function validateArchitectureGroups(architecture, errors) {
  for (const group of REQUIRED_ARCHITECTURE_GROUPS) {
    if (!(group in architecture)) {
      errors.push(`Missing architecture.${group}`);
    }
  }
  if (architecture.schemaVersion !== "1.0") {
    errors.push("architecture.schemaVersion must be 1.0");
  }
}

export function validatePackage(
  packageJson,
  packagePath,
  schemaValidator,
  allowMissingAjv = false
) {
  const errors = [];
  const warnings = [];

  applySchemaValidation(packageJson, schemaValidator, errors, warnings, allowMissingAjv);

  for (const field of REQUIRED_PACKAGE_FIELDS) {
    if (!(field in packageJson)) {
      errors.push(`Missing required package field: ${field}`);
    }
  }

  const architecture = packageJson.architecture;
  if (!isObject(architecture)) {
    errors.push("Missing or invalid architecture object");
    return {
      packagePath,
      packageName: packageJson.name ?? "(unknown)",
      valid: false,
      errors,
      warnings,
    };
  }

  validateArchitectureGroups(architecture, errors);
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
    warnings,
  };
}

export function validateLifecycleGovernanceConsistency(lifecycle, governance, errors) {
  if (!isObject(lifecycle) || !isObject(governance)) return;

  if (lifecycle.stage === "deprecated") {
    if (governance.promotionEligible === true) {
      errors.push(
        "architecture.governance.promotionEligible must be false for deprecated lifecycle stage"
      );
    }
    if (governance.changeControl !== "deprecation-review") {
      errors.push(
        "architecture.governance.changeControl must be deprecation-review for deprecated lifecycle stage"
      );
    }
    if (governance.semverPolicy !== "deprecated") {
      errors.push(
        "architecture.governance.semverPolicy must be deprecated for deprecated lifecycle stage"
      );
    }
  }

  if (lifecycle.stage === "external") {
    if (!["semver-required", "external-governed"].includes(governance.semverPolicy)) {
      errors.push(
        "architecture.governance.semverPolicy must be semver-required or external-governed for external lifecycle stage"
      );
    }
  }
}

export function validateComponent(component, errors) {
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
    "application",
    "library",
    "service",
    "api",
    "worker",
    "tool",
    "test",
    "documentation",
  ]);
  if (typeError) errors.push(typeError);
}

export function validateLifecycle(lifecycle, errors) {
  if (!isObject(lifecycle)) {
    errors.push("architecture.lifecycle must be an object");
    return;
  }

  const stages = [
    "experimental",
    "candidate",
    "active",
    "stable",
    "maintenance",
    "external",
    "deprecated",
  ];
  const roles = ["feature", "platform", "contract", "adapter", "tooling", "test"];

  const stageError = enumError("architecture.lifecycle.stage", lifecycle.stage, stages);
  if (stageError) errors.push(stageError);

  const roleError = enumError("architecture.lifecycle.role", lifecycle.role, roles);
  if (roleError) errors.push(roleError);

  const expectedClass = `${lifecycle.stage}.${lifecycle.role}`;
  if (lifecycle.class !== expectedClass) {
    errors.push(`architecture.lifecycle.class must equal ${expectedClass}`);
  }

  let expectedCatalogLifecycle;
  if (["experimental", "candidate"].includes(lifecycle.stage)) {
    expectedCatalogLifecycle = "experimental";
  } else if (lifecycle.stage === "deprecated") {
    expectedCatalogLifecycle = "deprecated";
  } else {
    expectedCatalogLifecycle = "production";
  }

  if (lifecycle.catalogLifecycle !== expectedCatalogLifecycle) {
    errors.push(
      `architecture.lifecycle.catalogLifecycle must equal ${expectedCatalogLifecycle} for stage ${lifecycle.stage}`
    );
  }

  if (lifecycle.stage === "external" && lifecycle.visibility !== "external") {
    errors.push("architecture.lifecycle.visibility must be external for external lifecycle stage");
  }

  if (lifecycle.stage === "deprecated") {
    if (lifecycle.visibility !== "deprecated") {
      errors.push(
        "architecture.lifecycle.visibility must be deprecated for deprecated lifecycle stage"
      );
    }
    if (!["deprecated", "unsupported"].includes(lifecycle.supportLevel)) {
      errors.push(
        "architecture.lifecycle.supportLevel must be deprecated or unsupported for deprecated lifecycle stage"
      );
    }
  }
}

export function validateGovernance(governance, errors) {
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
    "none",
    "internal-traceable",
    "compatibility-reviewed",
    "semver-required",
    "external-governed",
    "deprecated",
  ]);
  if (semverError) errors.push(semverError);

  const changeControlError = enumError(
    "architecture.governance.changeControl",
    governance.changeControl,
    [
      "none",
      "owner-review",
      "architecture-review",
      "security-review",
      "release-review",
      "deprecation-review",
    ]
  );
  if (changeControlError) errors.push(changeControlError);

  if (typeof governance.promotionEligible !== "boolean") {
    errors.push("architecture.governance.promotionEligible must be boolean");
  }
}

export function validateRuntime(runtime, errors) {
  if (!isObject(runtime)) {
    errors.push("architecture.runtime must be an object");
    return;
  }

  if (runtime.production === true && runtime.testOnly === true) {
    errors.push(
      "architecture.runtime.production and architecture.runtime.testOnly cannot both be true"
    );
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

export function validateBoundaries(boundaries, errors) {
  if (!isObject(boundaries)) {
    errors.push("architecture.boundaries must be an object");
    return;
  }

  if (boundaries.publicExportsOnly === true && boundaries.deepImportsAllowed === true) {
    errors.push(
      "architecture.boundaries.deepImportsAllowed must be false when publicExportsOnly is true"
    );
  }

  for (const field of ["allowedConsumers", "forbiddenConsumers"]) {
    if (!Array.isArray(boundaries[field])) {
      errors.push(`architecture.boundaries.${field} must be an array`);
    }
  }
}

export function validateRelations(relations, errors) {
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

export function validateTags(tags, errors) {
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

export function validateReadme(readme, errors) {
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

async function createSchemaValidator(schema, repoRoot) {
  const Ajv = await loadAjv(repoRoot);
  if (!Ajv) {
    return {
      missingAjv: true,
      validatorName: "ajv",
      validatorAvailable: false,
    };
  }

  const ajv = new Ajv({
    allErrors: true,
    strict: false,
  });

  return {
    missingAjv: false,
    validatorName: "ajv",
    validatorAvailable: true,
    validate: ajv.compile(schema),
  };
}

function buildReports(
  results,
  startedAt,
  finishedAt,
  schemaValidator,
  repoRoot,
  schemaPath,
  allowMissingAjv
) {
  const passed = results.filter((result) => result.valid).length;
  const failed = results.length - passed;

  const jsonReport = {
    generatedAt: finishedAt,
    schemaPath: path.relative(repoRoot, schemaPath),
    schemaValidator: {
      name: schemaValidator.validatorName,
      available: schemaValidator.validatorAvailable,
      missingAllowed: allowMissingAjv,
    },
    totalPackages: results.length,
    passed,
    failed,
    results: results.map((result) => ({
      ...result,
      packagePath: path.relative(repoRoot, result.packagePath),
    })),
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
    "",
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
    finishedAt,
  };
}

function writeReports(report, reportDir, jsonReportPath, markdownReportPath) {
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(jsonReportPath, `${JSON.stringify(report.jsonReport, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownReportPath, report.markdownReport, "utf8");
  return { jsonReportPath, markdownReportPath };
}

function writeSelfEvidence({
  report,
  startedAt,
  finishedAt,
  command,
  roots,
  outputPaths,
  exitCode,
  options,
  repoRoot,
  toolingReportDir,
}) {
  if (options.noReports) {
    return null;
  }

  fs.mkdirSync(toolingReportDir, { recursive: true });
  const safeTimestamp = finishedAt.replace(/[:.]/g, "-");
  const evidencePath = path.join(toolingReportDir, `${safeTimestamp}-run.json`);
  const evidence = {
    toolName: "validate-package-metadata",
    toolVersion:
      readJson(
        path.join(repoRoot, "tools", "architecture", "validate-package-metadata", "package.json")
      ).version ?? "0.0.0",
    command,
    mode: "check",
    root: repoRoot,
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
      "readme metadata rules",
    ],
    checksPassed: report.passed,
    checksFailed: report.failed,
    warnings: report.jsonReport.results.flatMap((result) =>
      result.warnings.map((message) => ({
        packageName: result.packageName,
        packagePath: result.packagePath,
        message,
      }))
    ),
    errors: report.jsonReport.results.flatMap((result) =>
      result.errors.map((message) => ({
        packageName: result.packageName,
        packagePath: result.packagePath,
        message,
      }))
    ),
    dependencySteps: [],
    schemaValidator: report.jsonReport.schemaValidator,
    gitTreatment: "reports/** ignored by default",
    exitCode,
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return evidencePath;
}

function printTextSummary(report, outputPaths, selfEvidencePath, repoRoot) {
  console.log(`Validated ${report.jsonReport.totalPackages} package.json file(s).`);
  console.log(`Passed: ${report.passed}`);
  console.log(`Failed: ${report.failed}`);
  console.log(`Schema validator: ${report.jsonReport.schemaValidator.name}`);
  console.log(`Schema validator available: ${report.jsonReport.schemaValidator.available}`);
  for (const outputPath of outputPaths) {
    console.log(`${outputPath.label}: ${path.relative(repoRoot, outputPath.path)}`);
  }
  if (selfEvidencePath) {
    console.log(`Self-evidence: ${path.relative(repoRoot, selfEvidencePath)}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = findRepoRoot(options.root ? path.resolve(options.root) : process.cwd());
  const schemaPath = path.join(
    repoRoot,
    "docs",
    "schemas",
    "package-json-architecture.schema.json"
  );
  const reportDir = path.join(repoRoot, "reports", "validation");
  const toolingReportDir = path.join(repoRoot, "reports", "tooling", "validate-package-metadata");
  const jsonReportPath = path.join(reportDir, "package-metadata-validation.json");
  const markdownReportPath = path.join(reportDir, "package-metadata-validation.md");

  const startedAt = new Date().toISOString();

  if (!fs.existsSync(schemaPath)) {
    console.error(`Schema not found: ${schemaPath}`);
    process.exit(1);
  }

  const schema = readJson(schemaPath);
  const schemaValidator = await createSchemaValidator(schema, repoRoot);

  const roots =
    options.roots.length > 0 ? options.roots : ["apps", "packages", "tools/architecture"];
  const packageFiles = listPackageJsonFiles(roots, repoRoot);
  const results = [];

  for (const packageFile of packageFiles) {
    try {
      const packageJson = readJson(packageFile);
      results.push(
        validatePackage(packageJson, packageFile, schemaValidator, options.allowMissingAjv)
      );
    } catch (error) {
      results.push({
        packagePath: packageFile,
        packageName: "(unreadable)",
        valid: false,
        errors: [error.message],
        warnings: [],
      });
    }
  }

  const finishedAt = new Date().toISOString();
  const report = buildReports(
    results,
    startedAt,
    finishedAt,
    schemaValidator,
    repoRoot,
    schemaPath,
    options.allowMissingAjv
  );
  const exitCode = report.failed === 0 ? 0 : 1;
  const outputPaths = [];

  if (!options.noReports) {
    const written = writeReports(report, reportDir, jsonReportPath, markdownReportPath);
    outputPaths.push({ label: "JSON report", path: written.jsonReportPath });
    outputPaths.push({ label: "Markdown report", path: written.markdownReportPath });
  }

  const selfEvidencePath = writeSelfEvidence({
    report,
    startedAt,
    finishedAt,
    command: [
      "node",
      "tools/architecture/validate-package-metadata/src/index.mjs",
      ...process.argv.slice(2),
    ],
    roots,
    outputPaths: outputPaths.map((outputPath) => path.relative(repoRoot, outputPath.path)),
    exitCode,
    options,
    repoRoot,
    toolingReportDir,
  });

  if (options.format === "json") {
    console.log(
      JSON.stringify(
        {
          toolName: "validate-package-metadata",
          totalPackages: report.jsonReport.totalPackages,
          passed: report.passed,
          failed: report.failed,
          schemaValidator: report.jsonReport.schemaValidator,
          outputPaths: outputPaths.map((outputPath) => path.relative(repoRoot, outputPath.path)),
          selfEvidencePath: selfEvidencePath ? path.relative(repoRoot, selfEvidencePath) : null,
          exitCode,
        },
        null,
        2
      )
    );
  } else {
    printTextSummary(report, outputPaths, selfEvidencePath, repoRoot);
  }

  process.exit(exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    if (process.env.__FORMAT === "json") {
      console.log(
        JSON.stringify(
          { toolName: "validate-package-metadata", error: error.message, exitCode: 1 },
          null,
          2
        )
      );
    } else {
      console.error(error.message);
    }
    process.exit(1);
  }
}
