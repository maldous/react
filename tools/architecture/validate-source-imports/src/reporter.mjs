import fs from "node:fs";
import path from "node:path";

export function buildJsonReport({ generatedAt, files, violations, repoRoot }) {
  const fileSet = new Set(violations.map((v) => v.file));
  const totalImports = files.reduce((sum, f) => sum + f.imports.length, 0);
  return {
    generatedAt,
    totalFiles: files.length,
    totalImports,
    passed: files.length - fileSet.size,
    failed: fileSet.size,
    violations: violations.map((v) => ({
      file: path.relative(repoRoot, v.file),
      package: v.packageName,
      specifier: v.specifier,
      rule: v.rule,
      message: v.message
    }))
  };
}

export function buildMarkdownReport(jsonReport) {
  const lines = [
    "# Source import boundary validation report",
    "",
    `Generated at: ${jsonReport.generatedAt}`,
    "",
    "## Summary",
    "",
    "```text",
    `Total files scanned: ${jsonReport.totalFiles}`,
    `Total imports checked: ${jsonReport.totalImports}`,
    `Passed: ${jsonReport.passed}`,
    `Failed: ${jsonReport.failed}`,
    "```"
  ];

  if (jsonReport.violations.length > 0) {
    lines.push("", "## Violations", "");
    for (const v of jsonReport.violations) {
      lines.push(`### ${v.file}`);
      lines.push("");
      lines.push(`- **Package**: ${v.package}`);
      lines.push(`- **Specifier**: \`${v.specifier}\``);
      lines.push(`- **Rule**: ${v.rule}`);
      lines.push(`- **Message**: ${v.message}`);
      lines.push("");
    }
  } else {
    lines.push("", "All source files satisfy import boundary rules.");
  }

  return `${lines.join("\n")}\n`;
}

export function writeReports(jsonReport, markdownReport, reportDir) {
  fs.mkdirSync(reportDir, { recursive: true });
  const jsonPath = path.join(reportDir, "source-import-validation.json");
  const mdPath = path.join(reportDir, "source-import-validation.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(jsonReport, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, markdownReport, "utf8");
  return { jsonPath, mdPath };
}

export function writeCommittedEvidence(jsonReport, repoRoot, toolVersion, scanRoots) {
  const evidenceDir = path.join(repoRoot, "docs", "evidence", "import-boundaries");
  fs.mkdirSync(evidenceDir, { recursive: true });

  const evidenceJson = {
    ...jsonReport,
    toolVersion,
    ruleSet: "ADR-0001, ADR-0002, ADR-0013, ADR-0014, ADR-0015, import-boundary-rules.md",
    scanMethod: "typescript-ast",
    scanRoots
  };

  const jsonPath = path.join(evidenceDir, "source-import-boundary-validation.json");
  const mdPath = path.join(evidenceDir, "source-import-boundary-validation.md");

  const mdLines = [
    "# Source import boundary validation evidence",
    "",
    `Generated at: ${jsonReport.generatedAt}`,
    `Tool version: ${toolVersion}`,
    `Scan method: typescript-ast`,
    `Rule set: ${evidenceJson.ruleSet}`,
    "",
    "## Result",
    "",
    "```text",
    `Total files scanned: ${jsonReport.totalFiles}`,
    `Total imports checked: ${jsonReport.totalImports}`,
    `Passed: ${jsonReport.passed}`,
    `Failed: ${jsonReport.failed}`,
    "```"
  ];

  if (jsonReport.violations.length === 0) {
    mdLines.push("", "All source files satisfy import boundary rules.");
  } else {
    mdLines.push("", "## Violations", "");
    for (const v of jsonReport.violations) {
      mdLines.push(`- ${v.file}: ${v.message} (rule: ${v.rule})`);
    }
  }

  fs.writeFileSync(jsonPath, `${JSON.stringify(evidenceJson, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, `${mdLines.join("\n")}\n`, "utf8");
  return { jsonPath, mdPath };
}

export function writeSelfEvidence({
  toolName,
  toolVersion,
  command,
  mode,
  repoRoot,
  startedAt,
  finishedAt,
  inputRoots,
  outputPaths,
  violations,
  checksPassed,
  checksFailed,
  warnings,
  exitCode,
  toolingReportDir
}) {
  fs.mkdirSync(toolingReportDir, { recursive: true });
  const safeTimestamp = finishedAt.replace(/[:.]/g, "-");
  const evidencePath = path.join(toolingReportDir, `${safeTimestamp}-run.json`);

  const evidence = {
    toolName,
    toolVersion,
    command,
    mode,
    root: repoRoot,
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    inputRoots,
    outputPaths,
    rulesEvaluated: [
      "no-deep-import",
      "no-test-support-in-prod",
      "no-relative-cross-package-import",
      "no-unlisted-platform-import",
      "no-react-in-domain",
      "no-graphql-in-domain",
      "no-adapters-in-domain",
      "no-domain-in-ui",
      "no-adapters-in-profile",
      "no-adapters-in-access-control",
      "no-react-in-access-control",
      "no-adapters-in-contracts-graphql",
      "no-adapters-in-contracts-ingestion",
      "no-adapters-in-contracts-analytics",
      "no-adapters-in-feature",
      "no-computed-dynamic-import",
      "no-unresolved-platform-import",
      "no-package-cycle",
      "no-unresolved-relative-import"
    ],
    checksPassed,
    checksFailed,
    warnings: warnings.map((w) => ({ message: w })),
    errors: violations.map((v) => ({
      file: path.relative(repoRoot, v.file),
      package: v.packageName,
      specifier: v.specifier,
      rule: v.rule,
      message: v.message
    })),
    dependencySteps: [],
    gitTreatment: "reports/** ignored by default",
    exitCode
  };

  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return evidencePath;
}
