#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { findRepoRoot as sharedFindRepoRoot } from "../../_shared/repo-root.mjs";
import { writeSelfEvidence as sharedWriteSelfEvidence } from "../../_shared/self-evidence.mjs";

export function parseArgs(argv) {
  const options = {
    command: "validate",
    root: process.cwd(),
    format: "text",
    noReports: false,
    planOnly: false,
    allowMissingAjv: false,
    evidenceGenerationRequested: false,
    strict: false,
  };

  const commands = new Set([
    "validate",
    "all",
    "generate-readmes",
    "generate-inventory",
    "generate-lifecycle-reports",
    "validate-evidence",
    "generate-lifecycle-evidence",
  ]);

  if (argv[0] && commands.has(argv[0])) {
    options.command = argv.shift();
  }

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
    } else if (arg === "--plan-only") {
      options.planOnly = true;
      i += 1;
    } else if (arg === "--allow-missing-ajv") {
      options.allowMissingAjv = true;
      i += 1;
    } else if (arg === "--evidence-generation-requested") {
      options.evidenceGenerationRequested = true;
      i += 1;
    } else if (arg === "--strict") {
      options.strict = true;
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!["text", "json"].includes(options.format)) {
    throw new Error("--format must be text or json");
  }

  return options;
}

export function findRepoRoot(startDir) {
  return sharedFindRepoRoot(startDir, "docs/schemas/package-json-architecture.schema.json");
}

function rel(filePath, repoRoot) {
  return path.relative(repoRoot, filePath);
}

function step(name, toolPath, args, repoRoot, required = true) {
  return {
    name,
    toolPath,
    scriptPath: path.join(repoRoot, toolPath, "src", "index.mjs"),
    args,
    required,
  };
}

export function buildStepCatalog(options, repoRoot) {
  const noReportsFlag = options.noReports ? ["--no-reports"] : [];
  const allowMissingAjvFlag = options.allowMissingAjv ? ["--allow-missing-ajv"] : [];
  const strictFlag = options.strict ? ["--strict"] : [];

  return {
    metadata: step(
      "validate-package-metadata",
      "tools/architecture/validate-package-metadata",
      ["--root", repoRoot, "--format", "json", ...noReportsFlag, ...allowMissingAjvFlag],
      repoRoot
    ),
    sourceImports: step(
      "validate-source-imports",
      "tools/architecture/validate-source-imports",
      ["--check", "--format", "json", ...noReportsFlag, ...strictFlag],
      repoRoot,
      true
    ),
    readmesCheck: step(
      "generate-package-readmes",
      "tools/architecture/generate-package-readmes",
      ["--check", "--format", "json", ...noReportsFlag],
      repoRoot,
      true
    ),
    readmesWrite: step(
      "generate-package-readmes",
      "tools/architecture/generate-package-readmes",
      ["--write", "--format", "json", ...noReportsFlag],
      repoRoot,
      true
    ),
    inventoryWrite: step(
      "generate-package-inventory",
      "tools/architecture/generate-package-inventory",
      ["--write", "--format", "json", ...noReportsFlag],
      repoRoot,
      true
    ),
    lifecycleReportsWrite: step(
      "generate-lifecycle-reports",
      "tools/architecture/generate-lifecycle-reports",
      ["--write"],
      repoRoot,
      false
    ),
    evidenceCheck: step(
      "validate-lifecycle-evidence",
      "tools/architecture/validate-lifecycle-evidence",
      ["--check", "--format", "json", ...noReportsFlag, ...allowMissingAjvFlag],
      repoRoot,
      true
    ),
    evidenceWrite: step(
      "generate-lifecycle-evidence",
      "tools/architecture/validate-lifecycle-evidence",
      ["--write", "--format", "json", ...noReportsFlag, ...allowMissingAjvFlag],
      repoRoot,
      true
    ),
    sliceReadiness: step(
      "validate-slice-readiness",
      "tools/architecture/validate-slice-readiness",
      [],
      repoRoot,
      true
    ),
    i18nValidation: step(
      "validate-i18n",
      "tools/architecture/validate-i18n",
      ["--strict"],
      repoRoot,
      true
    ),
    pipelineComposition: step(
      "validate-pipeline-composition",
      "tools/architecture/validate-pipeline-composition",
      ["--format", "json"],
      repoRoot,
      true
    ),
    composePorts: step(
      "validate-compose-ports",
      "tools/architecture/validate-compose-ports",
      ["--format", "json"],
      repoRoot,
      true
    ),
    actionRegister: step(
      "validate-action-register",
      "tools/architecture/validate-action-register",
      [],
      repoRoot,
      true
    ),
  };
}

export function planFor(command, options, repoRoot) {
  const s = buildStepCatalog(options, repoRoot);

  if (command === "validate") {
    return [s.metadata];
  }

  if (command === "all") {
    return [
      s.metadata,
      s.sourceImports,
      s.readmesCheck,
      s.inventoryWrite,
      s.lifecycleReportsWrite,
      s.evidenceCheck,
      s.sliceReadiness,
      s.i18nValidation,
      s.pipelineComposition,
      s.composePorts,
      s.actionRegister,
    ];
  }

  if (command === "generate-readmes") {
    return [s.metadata, s.readmesWrite];
  }

  if (command === "generate-inventory") {
    return [s.metadata, s.readmesCheck, s.inventoryWrite];
  }

  if (command === "generate-lifecycle-reports") {
    return [s.metadata, s.readmesCheck, s.inventoryWrite, s.lifecycleReportsWrite];
  }

  if (command === "validate-evidence") {
    return [
      s.metadata,
      s.sourceImports,
      s.readmesCheck,
      s.inventoryWrite,
      s.lifecycleReportsWrite,
      s.evidenceCheck,
      s.sliceReadiness,
    ];
  }

  if (command === "generate-lifecycle-evidence") {
    if (!options.evidenceGenerationRequested) {
      return [
        {
          name: "generate-lifecycle-evidence",
          error: "Evidence generation requires explicit transition intent.",
          required: true,
        },
      ];
    }
    return [
      s.metadata,
      s.sourceImports,
      s.readmesCheck,
      s.inventoryWrite,
      s.lifecycleReportsWrite,
      s.evidenceWrite,
      s.evidenceCheck,
    ];
  }

  throw new Error(`Unsupported command: ${command}`);
}

function runStep(stepItem, options, repoRoot) {
  if (stepItem.error) {
    return {
      name: stepItem.name,
      status: "failed",
      required: stepItem.required,
      exitCode: 1,
      stdout: "",
      stderr: stepItem.error,
      reason: stepItem.error,
    };
  }

  if (!fs.existsSync(stepItem.scriptPath)) {
    return {
      name: stepItem.name,
      status: stepItem.required ? "failed" : "skipped",
      required: stepItem.required,
      exitCode: stepItem.required ? 1 : 0,
      stdout: "",
      stderr: "",
      reason: "tool-not-implemented",
      scriptPath: rel(stepItem.scriptPath, repoRoot),
    };
  }

  if (options.planOnly) {
    return {
      name: stepItem.name,
      status: "planned",
      required: stepItem.required,
      exitCode: 0,
      stdout: "",
      stderr: "",
      reason: "plan-only",
      scriptPath: rel(stepItem.scriptPath, repoRoot),
    };
  }

  const result = spawnSync(process.execPath, [stepItem.scriptPath, ...stepItem.args], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  return {
    name: stepItem.name,
    status: result.status === 0 ? "passed" : "failed",
    required: stepItem.required,
    exitCode: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
    scriptPath: rel(stepItem.scriptPath, repoRoot),
  };
}

function executePlan(plan, options, repoRoot) {
  const results = [];
  let failedStep = null;

  for (const item of plan) {
    if (failedStep) {
      results.push({
        name: item.name,
        status: "skipped",
        required: item.required,
        exitCode: 0,
        reason: `skipped because ${failedStep.name} failed`,
      });
      continue;
    }

    const result = runStep(item, options, repoRoot);
    results.push(result);

    if (result.status === "failed" && result.required) {
      failedStep = result;
    }
  }

  return { results, failedStep };
}

function writeSelfEvidence({
  startedAt,
  finishedAt,
  plan,
  results,
  failedStep,
  exitCode,
  options,
  repoRoot,
  toolingReportDir,
}) {
  if (options.noReports) {
    return null;
  }
  const evidence = {
    toolName: "orchestrator",
    toolVersion:
      JSON.parse(
        fs.readFileSync(
          path.join(repoRoot, "tools", "architecture", "orchestrator", "package.json"),
          "utf8"
        )
      ).version ?? "0.0.0",
    command: ["node", "tools/architecture/orchestrator/src/index.mjs", options.command],
    mode: options.command,
    root: repoRoot,
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    inputRoots: [
      "apps",
      "packages",
      "tools/architecture",
      "docs/adr",
      "docs/schemas",
      "docs/evidence",
    ],
    outputPaths: [],
    rulesEvaluated: [
      "orchestrator dependency order",
      "required dependency stop-on-failure",
      "no default governance evidence generation",
      "tool command delegation",
    ],
    checksPassed: results.filter((result) =>
      ["passed", "planned", "skipped"].includes(result.status)
    ).length,
    checksFailed: results.filter((result) => result.status === "failed").length,
    warnings: results
      .filter((result) => result.status === "skipped")
      .map((result) => ({ step: result.name, reason: result.reason })),
    errors: results
      .filter((result) => result.status === "failed")
      .map((result) => ({ step: result.name, reason: result.reason ?? result.stderr })),
    dependencySteps: results.map(({ name, status, required, exitCode, reason }) => ({
      name,
      status,
      required,
      exitCode,
      reason,
    })),
    gitTreatment: "reports/** ignored by default",
    exitCode,
    dependencyOrder: plan.map((item) => item.name),
    stepsRun: results
      .filter((result) => ["passed", "failed", "planned"].includes(result.status))
      .map((result) => result.name),
    stepsSkipped: results
      .filter((result) => result.status === "skipped")
      .map((result) => result.name),
    failedStep: failedStep?.name ?? null,
    stopReason: failedStep ? `${failedStep.name} failed` : null,
    evidenceGenerationRequested: options.evidenceGenerationRequested,
    evidenceGenerated: false,
  };

  return sharedWriteSelfEvidence({ evidence, toolingReportDir, noReports: options.noReports });
}

function printText({
  plan,
  results,
  failedStep: _failedStep,
  evidencePath,
  exitCode,
  options,
  repoRoot,
}) {
  console.log(`Architecture tooling orchestrator: ${options.command}`);
  console.log("");
  console.log("Dependency order:");
  for (const item of plan) {
    console.log(`- ${item.name}`);
  }
  console.log("");
  console.log("Results:");
  for (const result of results) {
    const reasonSuffix = result.reason ? ` (${result.reason})` : "";
    console.log(`- ${result.name}: ${result.status}${reasonSuffix}`);
  }
  if (evidencePath) {
    console.log("");
    console.log(`Self-evidence: ${rel(evidencePath, repoRoot)}`);
  }
  console.log("");
  console.log(`Exit code: ${exitCode}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = findRepoRoot(path.resolve(options.root));
  const toolingReportDir = path.join(repoRoot, "reports", "tooling", "orchestrator");

  const startedAt = new Date().toISOString();
  const plan = planFor(options.command, options, repoRoot);
  const { results, failedStep } = executePlan(plan, options, repoRoot);
  const exitCode = failedStep ? 1 : 0;
  const finishedAt = new Date().toISOString();
  const evidencePath = writeSelfEvidence({
    startedAt,
    finishedAt,
    plan,
    results,
    failedStep,
    exitCode,
    options,
    repoRoot,
    toolingReportDir,
  });

  if (options.format === "json") {
    console.log(
      JSON.stringify(
        {
          command: options.command,
          dependencyOrder: plan.map((item) => item.name),
          results,
          failedStep: failedStep?.name ?? null,
          evidencePath: evidencePath ? rel(evidencePath, repoRoot) : null,
          exitCode,
        },
        null,
        2
      )
    );
  } else {
    printText({ plan, results, failedStep, evidencePath, exitCode, options, repoRoot });
  }

  process.exit(exitCode);
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    const options = { format: "text" };
    try {
      const parsed = parseArgs(process.argv.slice(2));
      options.format = parsed.format;
    } catch {
      // ignore parse error in error handler
    }
    if (options.format === "json") {
      console.log(JSON.stringify({ error: error.message, exitCode: 1 }, null, 2));
    } else {
      console.error(error.message);
    }
    process.exit(1);
  }
}
