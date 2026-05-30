import fs from "node:fs";
import path from "node:path";

function buildPackageGraphObj(packageGraph) {
  const obj = {};
  if (packageGraph) {
    for (const [pkg, deps] of packageGraph) {
      obj[pkg] = [...deps].sort();
    }
  }
  return obj;
}

function mapViolation(v, repoRoot) {
  return {
    file: path.relative(repoRoot, v.file),
    package: v.packageName,
    specifier: v.specifier,
    rule: v.rule,
    message: v.message,
    resolvedFile: v.resolvedFile ? path.relative(repoRoot, v.resolvedFile) : null,
    resolvedPackage: v.resolvedPackage ?? null,
  };
}

export function buildJsonReport({
  generatedAt,
  files,
  violations,
  repoRoot,
  toolVersion,
  scanMethod,
  strictMode,
  tsconfigPath,
  compilerOptionsSummary,
  edgeStats,
  packageGraph,
}) {
  const fileSet = new Set(violations.map((v) => v.file));
  const {
    totalImports,
    totalResolvedImports,
    totalUnresolvedImports,
    totalInternalEdges,
    totalExternalEdges,
    totalTypeOnlyEdges,
    totalDynamicImports,
  } = edgeStats ?? {};

  return {
    generatedAt,
    toolVersion: toolVersion ?? null,
    scanMethod: scanMethod ?? null,
    strictMode: strictMode ?? false,
    tsconfigPath: tsconfigPath ?? null,
    compilerOptionsSummary: compilerOptionsSummary ?? null,
    totalFiles: files.length,
    totalImports: totalImports ?? files.reduce((sum, f) => sum + f.imports.length, 0),
    totalResolvedImports: totalResolvedImports ?? null,
    totalUnresolvedImports: totalUnresolvedImports ?? null,
    totalInternalEdges: totalInternalEdges ?? null,
    totalExternalEdges: totalExternalEdges ?? null,
    totalTypeOnlyEdges: totalTypeOnlyEdges ?? null,
    totalDynamicImports: totalDynamicImports ?? null,
    passed: files.length - fileSet.size,
    failed: fileSet.size,
    packageGraph: buildPackageGraphObj(packageGraph),
    violations: violations.map((v) => mapViolation(v, repoRoot)),
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
    "```",
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
    scanMethod: "typescript-ast+typescript-module-resolution",
    scanRoots,
  };

  const jsonPath = path.join(evidenceDir, "source-import-boundary-validation.json");
  const mdPath = path.join(evidenceDir, "source-import-boundary-validation.md");

  const pkgGraphCount = Object.keys(jsonReport.packageGraph ?? {}).length;
  const co = jsonReport.compilerOptionsSummary ?? {};

  const mdLines = [
    "# Source import boundary validation evidence",
    "",
    "## Tool",
    "",
    "```text",
    `Tool version:   ${toolVersion}`,
    `Scan method:    typescript-ast+typescript-module-resolution`,
    `Strict mode:    ${jsonReport.strictMode ?? false}`,
    `tsconfig path:  ${jsonReport.tsconfigPath ?? "(none ? synthetic paths only)"}`,
    `Module resolution: Bundler`,
    `Path alias count:  ${co.pathAliasCount ?? 0}`,
    `Rule set:       ${evidenceJson.ruleSet}`,
    `Generated at:   ${jsonReport.generatedAt}`,
    "```",
    "",
    "## Result",
    "",
    "```text",
    `Total files scanned:     ${jsonReport.totalFiles}`,
    `Total imports checked:   ${jsonReport.totalImports}`,
    `  Resolved:              ${jsonReport.totalResolvedImports ?? "?"}`,
    `  Unresolved:            ${jsonReport.totalUnresolvedImports ?? "?"}`,
    `  Internal edges:        ${jsonReport.totalInternalEdges ?? "?"}`,
    `  External edges:        ${jsonReport.totalExternalEdges ?? "?"}`,
    `  Type-only:             ${jsonReport.totalTypeOnlyEdges ?? "?"}`,
    `  Dynamic imports:       ${jsonReport.totalDynamicImports ?? "?"}`,
    `Package graph packages:  ${pkgGraphCount}`,
    `Passed: ${jsonReport.passed}`,
    `Failed: ${jsonReport.failed}`,
    "```",
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
  toolingReportDir,
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
      "no-unexported-subpath-import",
      "no-unexported-package-entry",
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
      "no-architecture-in-product",
      "no-computed-dynamic-import",
      "no-unresolved-platform-import",
      "no-package-cycle",
      "no-unresolved-relative-import",
      "no-unresolved-alias",
    ],
    checksPassed,
    checksFailed,
    warnings: warnings.map((w) => ({ message: w })),
    errors: violations.map((v) => ({
      file: path.relative(repoRoot, v.file),
      package: v.packageName,
      specifier: v.specifier,
      rule: v.rule,
      message: v.message,
    })),
    dependencySteps: [],
    gitTreatment: "reports/** ignored by default",
    exitCode,
  };

  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return evidencePath;
}
