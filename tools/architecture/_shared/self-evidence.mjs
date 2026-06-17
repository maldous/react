import fs from "node:fs";
import path from "node:path";

// The self-evidence schema every architecture tool must emit (ADR-0012).
// Enforced by tools/architecture/orchestrator/tests/self-evidence.test.mjs;
// kept here as the single source of truth for the field list.
export const REQUIRED_EVIDENCE_FIELDS = [
  "toolName",
  "toolVersion",
  "command",
  "mode",
  "root",
  "startedAt",
  "finishedAt",
  "durationMs",
  "inputRoots",
  "outputPaths",
  "rulesEvaluated",
  "checksPassed",
  "checksFailed",
  "warnings",
  "errors",
  "dependencySteps",
  "gitTreatment",
  "exitCode",
];

// Write a fully-assembled self-evidence object to
// <toolingReportDir>/<finishedAt>-run.json. The caller owns the tool-specific
// assembly of `evidence`; this owns only the governed write mechanics and the
// --no-reports contract (ADR-0009/0011/0012). The timestamp in the filename is
// derived from evidence.finishedAt so output stays deterministic when the
// caller injects a fixed timestamp. Returns the path written, or null when
// reports are suppressed.
export function writeSelfEvidence({ evidence, toolingReportDir, noReports }) {
  if (noReports) {
    return null;
  }
  fs.mkdirSync(toolingReportDir, { recursive: true });
  const safeTimestamp = String(evidence.finishedAt).replace(/[:.]/g, "-");
  const evidencePath = path.join(toolingReportDir, `${safeTimestamp}-run.json`);
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return evidencePath;
}
