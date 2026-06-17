#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findRepoRoot as sharedFindRepoRoot } from "../../_shared/repo-root.mjs";
import { readJson } from "../../_shared/json.mjs";
import { writeSelfEvidence as sharedWriteSelfEvidence } from "../../_shared/self-evidence.mjs";

// Options that consume the next argument as their value
export const VALUE_OPTS = new Map([
  ["--root", "root"],
  ["--format", "format"],
  ["--package", "packageName"],
  ["--from-class", "fromClass"],
  ["--to-class", "toClass"],
  ["--reason", "reason"],
  ["--created-by", "createdBy"],
  ["--reviewer", "reviewer"],
  ["--approver", "approver"],
]);

// Options that are boolean flags
export const FLAG_OPTS = new Map([
  ["--no-reports", ["noReports", true]],
  ["--write", ["write", true]],
  ["--check", ["write", false]],
  ["--allow-missing-ajv", ["allowMissingAjv", true]],
]);

export function parseArgs(argv) {
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

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (VALUE_OPTS.has(arg)) {
      options[VALUE_OPTS.get(arg)] = argv[i + 1] ?? null;
      i += 2;
    } else if (FLAG_OPTS.has(arg)) {
      const [key, val] = FLAG_OPTS.get(arg);
      options[key] = val;
      i += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.roots.push(arg);
      i += 1;
    }
  }

  if (!["text", "json"].includes(options.format)) throw new Error("--format must be text or json");
  return options;
}

export function findRepoRoot(startDir) {
  return sharedFindRepoRoot(startDir, "docs/schemas");
}

async function loadAjv(toolRoot) {
  // Draft-2020-12 requires Ajv2020, not the default Ajv class
  const candidates = [
    () => import("ajv/dist/2020"),
    () => {
      const local = path.join(toolRoot, "node_modules", "ajv", "dist", "2020.js");
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

async function createSchemaValidator(schema, toolRoot, allowMissingAjv) {
  const Ajv = await loadAjv(toolRoot);
  if (!Ajv) {
    return {
      validatorAvailable: false,
      validate(bundle) {
        return allowMissingAjv
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

const REQUIRED_BUNDLE_FIELDS = [
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
];

export function validateBundleTopLevelFields(bundle, errors) {
  for (const field of REQUIRED_BUNDLE_FIELDS) {
    if (!(field in bundle)) errors.push(`Missing required field: ${field}`);
  }
  if (bundle.schemaVersion !== "1.0") errors.push("schemaVersion must be 1.0");
}

export function validateBundleTransition(bundle, errors) {
  const lifecycleClassPattern = /^[a-z]+\.[a-z]+$/;
  if (!lifecycleClassPattern.test(bundle.transition?.fromClass ?? ""))
    errors.push("transition.fromClass must use <stage>.<role> format");
  if (!lifecycleClassPattern.test(bundle.transition?.toClass ?? ""))
    errors.push("transition.toClass must use <stage>.<role> format");
}

export function validateBundleGovernance(bundle, errors) {
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
}

export function validateBundleTesting(bundle, errors) {
  if (!Array.isArray(bundle.testing?.evidence) || bundle.testing.evidence.length === 0)
    errors.push("testing.evidence must be non-empty");
}

export function validateBundleRollback(bundle, errors) {
  if (!bundle.rollback?.strategy) errors.push("rollback.strategy must be present");
}

export function validateBundleSnapshot(bundle, errors) {
  if (
    !bundle.sourceMetadataSnapshot?.packageJsonPath ||
    !bundle.sourceMetadataSnapshot?.architecture
  )
    errors.push("sourceMetadataSnapshot must include packageJsonPath and architecture");
}

export function fallbackValidate(bundle) {
  const errors = [];
  validateBundleTopLevelFields(bundle, errors);
  validateBundleTransition(bundle, errors);
  validateBundleGovernance(bundle, errors);
  validateBundleTesting(bundle, errors);
  validateBundleRollback(bundle, errors);
  validateBundleSnapshot(bundle, errors);
  return { valid: errors.length === 0, errors };
}

function listEvidenceFiles(searchRoots, repoRoot) {
  const results = [];
  for (const root of searchRoots) {
    const absoluteRoot = path.resolve(repoRoot, root);
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

function listPackageJsonFiles(repoRoot) {
  const roots = ["apps", "packages", "tools/architecture"];
  const ignored = new Set(["node_modules", ".git", "dist", "build", "coverage", "reports"]);
  const results = [];
  for (const root of roots) {
    const absoluteRoot = path.resolve(repoRoot, root);
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

function findPackage(packageName, repoRoot) {
  for (const packageFile of listPackageJsonFiles(repoRoot)) {
    const packageJson = readJson(packageFile);
    if (packageJson.name === packageName) return { packageFile, packageJson };
  }
  return null;
}

function transitionSlug(packageName, fromClass, toClass, createdAt) {
  const packageSlug = packageName
    .replace(/^@/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/(^-)|(-$)/g, "")
    .toLowerCase();
  const date = createdAt.slice(0, 10);
  return {
    packageSlug,
    dirSlug: `${date}-${fromClass.replace(".", "-")}-to-${toClass.replace(".", "-")}`,
  };
}

function buildBundle({ packageFile, packageJson }, options, repoRoot) {
  for (const field of ["packageName", "fromClass", "toClass", "reason"]) {
    if (!options[field]) {
      const flagName = field.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      throw new Error(`Missing required option for --write: --${flagName}`);
    }
  }

  const createdAt = process.env.ARCHITECTURE_EVIDENCE_CREATED_AT ?? new Date().toISOString();
  const a = packageJson.architecture;
  return {
    schemaVersion: "1.0",
    bundle: {
      id: `${packageJson.name}:${options.fromClass}->${options.toClass}:${createdAt}`,
      createdAt,
      createdBy: options.createdBy,
      status: "draft",
    },
    package: {
      name: packageJson.name,
      path: path.relative(repoRoot, packageFile),
      owner: a.component.owner,
    },
    transition: {
      fromClass: options.fromClass,
      toClass: options.toClass,
      reason: options.reason,
      requestedAt: createdAt,
    },
    governance: {
      decisionRefs: ["ADR-0010"],
      reviewers: [
        {
          name: options.reviewer,
          role: "reviewer",
          reviewedAt: createdAt,
          evidenceRef: "generated draft",
        },
      ],
      approvers: [
        {
          name: options.approver,
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
      packageJsonPath: path.relative(repoRoot, packageFile),
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

function writeGeneratedBundle(bundle, repoRoot) {
  const { packageSlug, dirSlug } = transitionSlug(
    bundle.package.name,
    bundle.transition.fromClass,
    bundle.transition.toClass,
    bundle.bundle.createdAt
  );
  const dir = path.join(repoRoot, "docs", "evidence", "lifecycle", packageSlug, dirSlug);
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, "transition-evidence.json");
  const mdPath = path.join(dir, "transition-evidence.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, renderMarkdown(bundle), "utf8");
  return [jsonPath, mdPath];
}

async function validateFiles(files, repoRoot, schemaPath, toolRoot, allowMissingAjv) {
  const schema = readJson(schemaPath);
  const validator = await createSchemaValidator(schema, toolRoot, allowMissingAjv);
  const results = [];
  for (const file of files) {
    try {
      const bundle = readJson(file);
      const validation = validator.validate(bundle);
      results.push({
        path: path.relative(repoRoot, file),
        valid: validation.valid,
        errors: validation.errors,
      });
    } catch (error) {
      results.push({ path: path.relative(repoRoot, file), valid: false, errors: [error.message] });
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
  options,
  repoRoot,
  toolPackagePath,
  toolingReportDir,
}) {
  if (options.noReports) return null;
  const evidence = {
    toolName: "validate-lifecycle-evidence",
    toolVersion: readJson(toolPackagePath).version ?? "0.0.0",
    command: [
      "node",
      "tools/architecture/validate-lifecycle-evidence/src/index.mjs",
      ...process.argv.slice(2),
    ],
    mode: options.write ? "write" : "check",
    root: repoRoot,
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
      missingAllowed: options.allowMissingAjv,
    },
    gitTreatment: "docs/evidence/** committed; reports/** ignored by default",
    exitCode,
  };
  return sharedWriteSelfEvidence({ evidence, toolingReportDir, noReports: options.noReports });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = findRepoRoot(options.root ? path.resolve(options.root) : process.cwd());
  const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const toolPackagePath = path.join(toolRoot, "package.json");
  const schemaPath = path.join(
    repoRoot,
    "docs",
    "schemas",
    "lifecycle-transition-evidence.schema.json"
  );
  const toolingReportDir = path.join(repoRoot, "reports", "tooling", "validate-lifecycle-evidence");

  const startedAt = new Date().toISOString();
  let roots = options.roots.length > 0 ? options.roots : ["docs/evidence/lifecycle"];
  let outputPaths = [];
  let files = listEvidenceFiles(roots, repoRoot);

  if (options.write) {
    const found = findPackage(options.packageName, repoRoot);
    if (!found) throw new Error(`Package not found: ${options.packageName}`);
    const bundle = buildBundle(found, options, repoRoot);
    outputPaths = writeGeneratedBundle(bundle, repoRoot).map((file) =>
      path.relative(repoRoot, file)
    );
    files = outputPaths
      .filter((file) => file.endsWith(".json"))
      .map((file) => path.join(repoRoot, file));
    roots = ["docs/evidence/lifecycle"];
  }

  const { results, validatorAvailable } = await validateFiles(
    files,
    repoRoot,
    schemaPath,
    toolRoot,
    options.allowMissingAjv
  );
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
    options,
    repoRoot,
    toolPackagePath,
    toolingReportDir,
  });
  const summary = {
    toolName: "validate-lifecycle-evidence",
    mode: options.write ? "write" : "check",
    totalEvidenceFiles: results.length,
    passed: results.filter((r) => r.valid).length,
    failed,
    results,
    outputPaths,
    selfEvidencePath: selfEvidencePath ? path.relative(repoRoot, selfEvidencePath) : null,
    exitCode,
  };

  if (options.format === "json") console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`Lifecycle evidence ${options.write ? "generation" : "validation"}`);
    console.log(`Evidence files: ${summary.totalEvidenceFiles}`);
    console.log(`Passed: ${summary.passed}`);
    console.log(`Failed: ${summary.failed}`);
    if (selfEvidencePath)
      console.log(`Self-evidence: ${path.relative(repoRoot, selfEvidencePath)}`);
  }
  process.exit(exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    if (process.argv.includes("--format=json") || process.argv.includes("json")) {
      console.log(
        JSON.stringify(
          { toolName: "validate-lifecycle-evidence", error: error.message, exitCode: 1 },
          null,
          2
        )
      );
    } else console.error(error.message);
    process.exit(1);
  }
}
