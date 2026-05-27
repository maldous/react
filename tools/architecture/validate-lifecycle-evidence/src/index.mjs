#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

function parseArgs(argv) {
  const options = {
    root: null,
    format: "text",
    noReports: false,
    write: false,
    allowMissingAjv: false,
    packageName: null,
    fromClass: null,
    toClass: null,
    reason: null,
    createdBy: "architecture-tooling",
    reviewer: "architecture-reviewer",
    approver: "architecture-approver",
    roots: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--root") options.root = argv[++index];
    else if (arg === "--format") options.format = argv[++index] ?? "text";
    else if (arg === "--no-reports") options.noReports = true;
    else if (arg === "--write") options.write = true;
    else if (arg === "--check") options.write = false;
    else if (arg === "--allow-missing-ajv") options.allowMissingAjv = true;
    else if (arg === "--package") options.packageName = argv[++index];
    else if (arg === "--from-class") options.fromClass = argv[++index];
    else if (arg === "--to-class") options.toClass = argv[++index];
    else if (arg === "--reason") options.reason = argv[++index];
    else if (arg === "--created-by") options.createdBy = argv[++index];
    else if (arg === "--reviewer") options.reviewer = argv[++index];
    else if (arg === "--approver") options.approver = argv[++index];
    else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else options.roots.push(arg);
  }

  if (!["text", "json"].includes(options.format)) throw new Error("--format must be text or json");
  return options;
}

const OPTIONS = parseArgs(process.argv.slice(2));
const REPO_ROOT = findRepoRoot(OPTIONS.root ? path.resolve(OPTIONS.root) : process.cwd());
const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOL_PACKAGE_PATH = path.join(TOOL_ROOT, "package.json");
const SCHEMA_PATH = path.join(
  REPO_ROOT,
  "docs",
  "schemas",
  "lifecycle-transition-evidence.schema.json"
);
const TOOLING_REPORT_DIR = path.join(
  REPO_ROOT,
  "reports",
  "tooling",
  "validate-lifecycle-evidence"
);

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, "docs", "schemas"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function loadAjv() {
  // Draft-2020-12 requires Ajv2020, not the default Ajv class
  const candidates = [
    () => import("ajv/dist/2020"),
    () => {
      const local = path.join(TOOL_ROOT, "node_modules", "ajv", "dist", "2020.js");
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

async function createSchemaValidator(schema) {
  const Ajv = await loadAjv();
  if (!Ajv) {
    return {
      validatorAvailable: false,
      validate(bundle) {
        return OPTIONS.allowMissingAjv
          ? fallbackValidate(bundle)
          : {
              valid: false,
              errors: ["Ajv JSON Schema validation dependency is unavailable"],
            };
      },
    };
  }

  const ajv = new Ajv({ allErrors: true, strict: false, formats: { "date-time": true } });
  const validate = ajv.compile(schema);
  return {
    validatorAvailable: true,
    validate(bundle) {
      const valid = validate(bundle);
      return {
        valid,
        errors: valid
          ? []
          : (validate.errors ?? []).map((error) => {
              const pathLabel = error.instancePath
                ? error.instancePath.replaceAll("/", ".").replace(/^\./, "")
                : "(root)";
              return `schema:${pathLabel} ${error.message}`;
            }),
      };
    },
  };
}

function fallbackValidate(bundle) {
  const errors = [];
  for (const field of [
    "schemaVersion",
    "bundle",
    "package",
    "transition",
    "governance",
    "risk",
    "testing",
    "impact",
    "rollback",
    "sourceMetadataSnapshot",
    "reportReferences",
  ]) {
    if (!(field in bundle)) errors.push(`Missing required field: ${field}`);
  }
  if (bundle.schemaVersion !== "1.0") errors.push("schemaVersion must be 1.0");

  const lifecycleClassPattern = /^[a-z]+\.[a-z]+$/;
  if (!lifecycleClassPattern.test(bundle.transition?.fromClass ?? ""))
    errors.push("transition.fromClass must use <stage>.<role> format");
  if (!lifecycleClassPattern.test(bundle.transition?.toClass ?? ""))
    errors.push("transition.toClass must use <stage>.<role> format");

  if (
    !Array.isArray(bundle.governance?.decisionRefs) ||
    bundle.governance.decisionRefs.length === 0
  ) {
    errors.push("governance.decisionRefs must be non-empty");
  } else {
    for (const decisionRef of bundle.governance.decisionRefs) {
      if (!/^ADR-\d{4}$/.test(decisionRef)) {
        errors.push(`governance.decisionRefs contains invalid ADR ref: ${decisionRef}`);
      }
    }
  }

  if (!Array.isArray(bundle.governance?.reviewers) || bundle.governance.reviewers.length === 0)
    errors.push("governance.reviewers must be non-empty");
  if (!Array.isArray(bundle.governance?.approvers) || bundle.governance.approvers.length === 0)
    errors.push("governance.approvers must be non-empty");
  if (!Array.isArray(bundle.testing?.evidence) || bundle.testing.evidence.length === 0)
    errors.push("testing.evidence must be non-empty");
  if (!bundle.rollback?.strategy) errors.push("rollback.strategy must be present");
  if (
    !bundle.sourceMetadataSnapshot?.packageJsonPath ||
    !bundle.sourceMetadataSnapshot?.architecture
  )
    errors.push("sourceMetadataSnapshot must include packageJsonPath and architecture");
  return { valid: errors.length === 0, errors };
}

function listEvidenceFiles(searchRoots) {
  const results = [];
  for (const root of searchRoots) {
    const absoluteRoot = path.resolve(REPO_ROOT, root);
    if (!fs.existsSync(absoluteRoot)) continue;
    walk(absoluteRoot);
  }
  return [...new Set(results)].sort();

  function walk(current) {
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) walk(path.join(current, entry));
      return;
    }
    if (path.basename(current) === "transition-evidence.json") results.push(current);
  }
}

function listPackageJsonFiles() {
  const roots = ["apps", "packages", "tools/architecture"];
  const ignored = new Set(["node_modules", ".git", "dist", "build", "coverage", "reports"]);
  const results = [];
  for (const root of roots) {
    const absoluteRoot = path.resolve(REPO_ROOT, root);
    if (!fs.existsSync(absoluteRoot)) continue;
    walk(absoluteRoot);
  }
  return results.sort();

  function walk(current) {
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      if (ignored.has(path.basename(current))) return;
      for (const entry of fs.readdirSync(current)) walk(path.join(current, entry));
      return;
    }
    if (path.basename(current) === "package.json") results.push(current);
  }
}

function findPackage(packageName) {
  for (const packageFile of listPackageJsonFiles()) {
    const packageJson = readJson(packageFile);
    if (packageJson.name === packageName) return { packageFile, packageJson };
  }
  return null;
}

function transitionSlug(packageName, fromClass, toClass, createdAt) {
  const packageSlug = packageName
    .replace(/^@/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const date = createdAt.slice(0, 10);
  return {
    packageSlug,
    dirSlug: `${date}-${fromClass.replace(".", "-")}-to-${toClass.replace(".", "-")}`,
  };
}

function buildBundle({ packageFile, packageJson }) {
  for (const field of ["packageName", "fromClass", "toClass", "reason"]) {
    if (!OPTIONS[field])
      throw new Error(
        `Missing required option for --write: --${field.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`
      );
  }

  const createdAt = process.env.ARCHITECTURE_EVIDENCE_CREATED_AT ?? new Date().toISOString();
  const a = packageJson.architecture;
  return {
    schemaVersion: "1.0",
    bundle: {
      id: `${packageJson.name}:${OPTIONS.fromClass}->${OPTIONS.toClass}:${createdAt}`,
      createdAt,
      createdBy: OPTIONS.createdBy,
      status: "draft",
    },
    package: {
      name: packageJson.name,
      path: path.relative(REPO_ROOT, packageFile),
      owner: a.component.owner,
    },
    transition: {
      fromClass: OPTIONS.fromClass,
      toClass: OPTIONS.toClass,
      reason: OPTIONS.reason,
      requestedAt: createdAt,
    },
    governance: {
      decisionRefs: ["ADR-0010"],
      reviewers: [
        {
          name: OPTIONS.reviewer,
          role: "reviewer",
          reviewedAt: createdAt,
          evidenceRef: "generated draft",
        },
      ],
      approvers: [
        {
          name: OPTIONS.approver,
          role: "approver",
          reviewedAt: createdAt,
          evidenceRef: "generated draft",
        },
      ],
    },
    risk: {
      level: "medium",
      assessment: "Generated draft requires human review before approval.",
      mitigations: ["Review package consumers", "Confirm tests and rollback plan before approval"],
    },
    testing: {
      summary: "Generated draft. Attach concrete test evidence before approval.",
      evidence: [
        {
          path: "reports/lifecycle/package-lifecycle-summary.json",
          description: "Lifecycle report reference",
        },
      ],
    },
    impact: {
      runtimeImpact: "Generated draft. Confirm runtime impact before approval.",
      consumerImpact: "Generated draft. Confirm consumer impact before approval.",
    },
    rollback: {
      strategy: "Revert lifecycle metadata change and regenerate reports.",
      notes: "Generated draft.",
    },
    sourceMetadataSnapshot: {
      packageJsonPath: path.relative(REPO_ROOT, packageFile),
      architecture: a,
    },
    reportReferences: [
      {
        path: "reports/package-inventory/package-inventory.json",
        description: "Package inventory report",
      },
      {
        path: "reports/lifecycle/package-lifecycle-summary.json",
        description: "Lifecycle summary report",
      },
    ],
  };
}

function renderMarkdown(bundle) {
  return `# Lifecycle transition evidence

## Package

\`\`\`text
Name: ${bundle.package.name}
Path: ${bundle.package.path}
Owner: ${bundle.package.owner}
\`\`\`

## Transition

\`\`\`text
From: ${bundle.transition.fromClass}
To: ${bundle.transition.toClass}
Reason: ${bundle.transition.reason}
Requested at: ${bundle.transition.requestedAt}
\`\`\`

## Governance

\`\`\`text
Decision refs: ${bundle.governance.decisionRefs.join(", ")}
Status: ${bundle.bundle.status}
\`\`\`

## Risk

\`\`\`text
Level: ${bundle.risk.level}
Assessment: ${bundle.risk.assessment}
\`\`\`

## Testing

${bundle.testing.summary}

## Impact

\`\`\`text
Runtime: ${bundle.impact.runtimeImpact}
Consumers: ${bundle.impact.consumerImpact}
\`\`\`

## Rollback

${bundle.rollback.strategy}
`;
}

function writeGeneratedBundle(bundle) {
  const { packageSlug, dirSlug } = transitionSlug(
    bundle.package.name,
    bundle.transition.fromClass,
    bundle.transition.toClass,
    bundle.bundle.createdAt
  );
  const dir = path.join(REPO_ROOT, "docs", "evidence", "lifecycle", packageSlug, dirSlug);
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, "transition-evidence.json");
  const mdPath = path.join(dir, "transition-evidence.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, renderMarkdown(bundle), "utf8");
  return [jsonPath, mdPath];
}

async function validateFiles(files) {
  const schema = readJson(SCHEMA_PATH);
  const validator = await createSchemaValidator(schema);
  const results = [];
  for (const file of files) {
    try {
      const bundle = readJson(file);
      const validation = validator.validate(bundle);
      results.push({
        path: path.relative(REPO_ROOT, file),
        valid: validation.valid,
        errors: validation.errors,
      });
    } catch (error) {
      results.push({ path: path.relative(REPO_ROOT, file), valid: false, errors: [error.message] });
    }
  }
  return { results, validatorAvailable: validator.validatorAvailable };
}

function writeSelfEvidence({
  startedAt,
  finishedAt,
  roots,
  results,
  outputPaths,
  exitCode,
  validatorAvailable,
}) {
  if (OPTIONS.noReports) return null;
  fs.mkdirSync(TOOLING_REPORT_DIR, { recursive: true });
  const safeTimestamp = finishedAt.replace(/[:.]/g, "-");
  const evidencePath = path.join(TOOLING_REPORT_DIR, `${safeTimestamp}-run.json`);
  const evidence = {
    toolName: "validate-lifecycle-evidence",
    toolVersion: readJson(TOOL_PACKAGE_PATH).version ?? "0.0.0",
    command: [
      "node",
      "tools/architecture/validate-lifecycle-evidence/src/index.mjs",
      ...process.argv.slice(2),
    ],
    mode: OPTIONS.write ? "write" : "check",
    root: REPO_ROOT,
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    inputRoots: roots,
    outputPaths,
    rulesEvaluated: [
      "lifecycle transition evidence schema validation",
      "lifecycle evidence generation",
    ],
    checksPassed: results.filter((r) => r.valid).length,
    checksFailed: results.filter((r) => !r.valid).length,
    warnings: [],
    errors: results.flatMap((r) => r.errors.map((message) => ({ path: r.path, message }))),
    dependencySteps: [],
    schemaValidator: {
      name: "ajv",
      available: validatorAvailable,
      missingAllowed: OPTIONS.allowMissingAjv,
    },
    gitTreatment: "docs/evidence/** committed; reports/** ignored by default",
    exitCode,
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return evidencePath;
}

async function main() {
  const startedAt = new Date().toISOString();
  let roots = OPTIONS.roots.length > 0 ? OPTIONS.roots : ["docs/evidence/lifecycle"];
  let outputPaths = [];
  let files = listEvidenceFiles(roots);

  if (OPTIONS.write) {
    const found = findPackage(OPTIONS.packageName);
    if (!found) throw new Error(`Package not found: ${OPTIONS.packageName}`);
    const bundle = buildBundle(found);
    outputPaths = writeGeneratedBundle(bundle).map((file) => path.relative(REPO_ROOT, file));
    files = outputPaths
      .filter((file) => file.endsWith(".json"))
      .map((file) => path.join(REPO_ROOT, file));
    roots = ["docs/evidence/lifecycle"];
  }

  const { results, validatorAvailable } = await validateFiles(files);
  const failed = results.filter((result) => !result.valid).length;
  const exitCode = failed === 0 ? 0 : 1;
  const finishedAt = new Date().toISOString();
  const selfEvidencePath = writeSelfEvidence({
    startedAt,
    finishedAt,
    roots,
    results,
    outputPaths,
    exitCode,
    validatorAvailable,
  });
  const summary = {
    toolName: "validate-lifecycle-evidence",
    mode: OPTIONS.write ? "write" : "check",
    totalEvidenceFiles: results.length,
    passed: results.filter((r) => r.valid).length,
    failed,
    results,
    outputPaths,
    selfEvidencePath: selfEvidencePath ? path.relative(REPO_ROOT, selfEvidencePath) : null,
    exitCode,
  };

  if (OPTIONS.format === "json") console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`Lifecycle evidence ${OPTIONS.write ? "generation" : "validation"}`);
    console.log(`Evidence files: ${summary.totalEvidenceFiles}`);
    console.log(`Passed: ${summary.passed}`);
    console.log(`Failed: ${summary.failed}`);
    if (selfEvidencePath)
      console.log(`Self-evidence: ${path.relative(REPO_ROOT, selfEvidencePath)}`);
  }
  process.exit(exitCode);
}

try {
  await main();
} catch (error) {
  if (OPTIONS.format === "json")
    console.log(
      JSON.stringify(
        { toolName: "validate-lifecycle-evidence", error: error.message, exitCode: 1 },
        null,
        2
      )
    );
  else console.error(error.message);
  process.exit(1);
}
