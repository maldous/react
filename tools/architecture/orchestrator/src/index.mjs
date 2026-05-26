#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const options = {
    command: "validate",
    root: process.cwd(),
    format: "text",
    noReports: false,
    planOnly: false,
    allowMissingAjv: false,
    evidenceGenerationRequested: false
  };

  const commands = new Set(["validate", "all", "generate-readmes", "generate-inventory", "generate-lifecycle-reports", "validate-evidence", "generate-lifecycle-evidence"]);

  if (argv[0] && commands.has(argv[0])) {
    options.command = argv.shift();
  }

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

    if (arg === "--plan-only") {
      options.planOnly = true;
      continue;
    }

    if (arg === "--allow-missing-ajv") {
      options.allowMissingAjv = true;
      continue;
    }

    if (arg === "--evidence-generation-requested") {
      options.evidenceGenerationRequested = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!["text", "json"].includes(options.format)) {
    throw new Error("--format must be text or json");
  }

  return options;
}

const OPTIONS = parseArgs(process.argv.slice(2));
const REPO_ROOT = findRepoRoot(path.resolve(OPTIONS.root));
const TOOLING_REPORT_DIR = path.join(REPO_ROOT, "reports", "tooling", "orchestrator");

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

function rel(filePath) {
  return path.relative(REPO_ROOT, filePath);
}

function step(name, toolPath, args, required = true) {
  return {
    name,
    toolPath,
    scriptPath: path.join(REPO_ROOT, toolPath, "src", "index.mjs"),
    args,
    required
  };
}

function planFor(command) {
  const metadata = step("validate-package-metadata", "tools/architecture/validate-package-metadata", [
    "--root", REPO_ROOT,
    "--format", "json",
    ...(OPTIONS.noReports ? ["--no-reports"] : []),
    ...(OPTIONS.allowMissingAjv ? ["--allow-missing-ajv"] : [])
  ]);

  const plannedOnly = {
    "generate-package-readmes": step("generate-package-readmes", "tools/architecture/generate-package-readmes", ["--check", "--format", "json", ...(OPTIONS.noReports ? ["--no-reports"] : [])], true),
    "generate-package-inventory": step("generate-package-inventory", "tools/architecture/generate-package-inventory", ["--check", "--format", "json", ...(OPTIONS.noReports ? ["--no-reports"] : [])], true),
    "generate-lifecycle-reports": step("generate-lifecycle-reports", "tools/architecture/generate-lifecycle-reports", ["--check"], false),
    "validate-lifecycle-evidence": step("validate-lifecycle-evidence", "tools/architecture/validate-lifecycle-evidence", ["--check", "--format", "json", ...(OPTIONS.noReports ? ["--no-reports"] : []), ...(OPTIONS.allowMissingAjv ? ["--allow-missing-ajv"] : [])], true),
    "generate-lifecycle-evidence": step("generate-lifecycle-evidence", "tools/architecture/validate-lifecycle-evidence", ["--write", "--format", "json", ...(OPTIONS.noReports ? ["--no-reports"] : []), ...(OPTIONS.allowMissingAjv ? ["--allow-missing-ajv"] : [])], true)
  };

  if (command === "validate") {
    return [metadata];
  }

  if (command === "all") {
    return [
      metadata,
      plannedOnly["generate-package-readmes"],
      plannedOnly["generate-package-inventory"],
      plannedOnly["generate-lifecycle-reports"],
      plannedOnly["validate-lifecycle-evidence"]
    ];
  }

  if (command === "generate-readmes") {
    return [metadata, { ...plannedOnly["generate-package-readmes"], args: ["--write", "--format", "json", ...(OPTIONS.noReports ? ["--no-reports"] : [])] }];
  }

  if (command === "generate-inventory") {
    return [metadata, plannedOnly["generate-package-readmes"], { ...plannedOnly["generate-package-inventory"], args: ["--write", "--format", "json", ...(OPTIONS.noReports ? ["--no-reports"] : [])] }];
  }

  if (command === "generate-lifecycle-reports") {
    return [metadata, plannedOnly["generate-package-readmes"], plannedOnly["generate-package-inventory"], { ...plannedOnly["generate-lifecycle-reports"], args: ["--write"] }];
  }

  if (command === "validate-evidence") {
    return [metadata, plannedOnly["generate-package-readmes"], plannedOnly["generate-package-inventory"], plannedOnly["generate-lifecycle-reports"], plannedOnly["validate-lifecycle-evidence"]];
  }

  if (command === "generate-lifecycle-evidence") {
    if (!OPTIONS.evidenceGenerationRequested) {
      return [{
        name: "generate-lifecycle-evidence",
        error: "Evidence generation requires explicit transition intent.",
        required: true
      }];
    }
    return [metadata, plannedOnly["generate-package-readmes"], plannedOnly["generate-package-inventory"], plannedOnly["generate-lifecycle-reports"], plannedOnly["generate-lifecycle-evidence"], plannedOnly["validate-lifecycle-evidence"]];
  }

  throw new Error(`Unsupported command: ${command}`);
}

function runStep(stepItem) {
  if (stepItem.error) {
    return {
      name: stepItem.name,
      status: "failed",
      required: stepItem.required,
      exitCode: 1,
      stdout: "",
      stderr: stepItem.error,
      reason: stepItem.error
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
      scriptPath: rel(stepItem.scriptPath)
    };
  }

  if (OPTIONS.planOnly) {
    return {
      name: stepItem.name,
      status: "planned",
      required: stepItem.required,
      exitCode: 0,
      stdout: "",
      stderr: "",
      reason: "plan-only",
      scriptPath: rel(stepItem.scriptPath)
    };
  }

  const result = spawnSync(process.execPath, [stepItem.scriptPath, ...stepItem.args], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });

  return {
    name: stepItem.name,
    status: result.status === 0 ? "passed" : "failed",
    required: stepItem.required,
    exitCode: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
    scriptPath: rel(stepItem.scriptPath)
  };
}

function executePlan(plan) {
  const results = [];
  let failedStep = null;

  for (const item of plan) {
    if (failedStep) {
      results.push({
        name: item.name,
        status: "skipped",
        required: item.required,
        exitCode: 0,
        reason: `skipped because ${failedStep.name} failed`
      });
      continue;
    }

    const result = runStep(item);
    results.push(result);

    if (result.status === "failed" && result.required) {
      failedStep = result;
    }
  }

  return { results, failedStep };
}

function writeSelfEvidence({ startedAt, finishedAt, plan, results, failedStep, exitCode }) {
  if (OPTIONS.noReports) {
    return null;
  }

  fs.mkdirSync(TOOLING_REPORT_DIR, { recursive: true });
  const safeTimestamp = finishedAt.replace(/[:.]/g, "-");
  const evidencePath = path.join(TOOLING_REPORT_DIR, `${safeTimestamp}-run.json`);

  const evidence = {
    toolName: "orchestrator",
    toolVersion: JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools", "architecture", "orchestrator", "package.json"), "utf8")).version ?? "0.0.0",
    command: ["node", "tools/architecture/orchestrator/src/index.mjs", OPTIONS.command],
    mode: OPTIONS.command,
    root: REPO_ROOT,
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    inputRoots: ["apps", "packages", "tools/architecture", "docs/adr", "docs/schemas", "docs/evidence"],
    outputPaths: [],
    rulesEvaluated: [
      "orchestrator dependency order",
      "required dependency stop-on-failure",
      "no default governance evidence generation",
      "tool command delegation"
    ],
    checksPassed: results.filter((result) => ["passed", "planned", "skipped"].includes(result.status)).length,
    checksFailed: results.filter((result) => result.status === "failed").length,
    warnings: results.filter((result) => result.status === "skipped").map((result) => ({ step: result.name, reason: result.reason })),
    errors: results.filter((result) => result.status === "failed").map((result) => ({ step: result.name, reason: result.reason ?? result.stderr })),
    dependencySteps: results.map(({ name, status, required, exitCode, reason }) => ({ name, status, required, exitCode, reason })),
    gitTreatment: "reports/** ignored by default",
    exitCode,
    dependencyOrder: plan.map((item) => item.name),
    stepsRun: results.filter((result) => ["passed", "failed", "planned"].includes(result.status)).map((result) => result.name),
    stepsSkipped: results.filter((result) => result.status === "skipped").map((result) => result.name),
    failedStep: failedStep?.name ?? null,
    stopReason: failedStep ? `${failedStep.name} failed` : null,
    evidenceGenerationRequested: OPTIONS.evidenceGenerationRequested,
    evidenceGenerated: false
  };

  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return evidencePath;
}

function printText({ plan, results, failedStep, evidencePath, exitCode }) {
  console.log(`Architecture tooling orchestrator: ${OPTIONS.command}`);
  console.log("");
  console.log("Dependency order:");
  for (const item of plan) {
    console.log(`- ${item.name}`);
  }
  console.log("");
  console.log("Results:");
  for (const result of results) {
    console.log(`- ${result.name}: ${result.status}${result.reason ? ` (${result.reason})` : ""}`);
  }
  if (evidencePath) {
    console.log("");
    console.log(`Self-evidence: ${rel(evidencePath)}`);
  }
  console.log("");
  console.log(`Exit code: ${exitCode}`);
}

function main() {
  const startedAt = new Date().toISOString();
  const plan = planFor(OPTIONS.command);
  const { results, failedStep } = executePlan(plan);
  const exitCode = failedStep ? 1 : 0;
  const finishedAt = new Date().toISOString();
  const evidencePath = writeSelfEvidence({ startedAt, finishedAt, plan, results, failedStep, exitCode });

  if (OPTIONS.format === "json") {
    console.log(JSON.stringify({
      command: OPTIONS.command,
      dependencyOrder: plan.map((item) => item.name),
      results,
      failedStep: failedStep?.name ?? null,
      evidencePath: evidencePath ? rel(evidencePath) : null,
      exitCode
    }, null, 2));
  } else {
    printText({ plan, results, failedStep, evidencePath, exitCode });
  }

  process.exit(exitCode);
}

try {
  main();
} catch (error) {
  if (OPTIONS.format === "json") {
    console.log(JSON.stringify({ error: error.message, exitCode: 1 }, null, 2));
  } else {
    console.error(error.message);
  }
  process.exit(1);
}
