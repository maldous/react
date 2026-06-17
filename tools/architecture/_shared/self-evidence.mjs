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
  // --no-reports short-circuits BEFORE validation: suppressing reports must
  // never fail a run, and callers may legitimately pass partial/no evidence.
  if (noReports) {
    return null;
  }
  // Fail closed: a self-evidence write that is silently malformed is worse than
  // a loud failure (ADR-0012 — auditable, fail-closed tooling).
  if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence)) {
    throw new Error("writeSelfEvidence: evidence must be a non-null object");
  }
  for (const field of REQUIRED_EVIDENCE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(evidence, field)) {
      throw new Error(`writeSelfEvidence: evidence missing required field "${field}"`);
    }
  }
  const { finishedAt } = evidence;
  if (typeof finishedAt !== "string" || finishedAt.length === 0 || /[\\/]/.test(finishedAt)) {
    throw new Error(
      `writeSelfEvidence: evidence.finishedAt must be a non-empty path-safe string for filename generation (got ${JSON.stringify(finishedAt)})`
    );
  }
  fs.mkdirSync(toolingReportDir, { recursive: true });
  const safeTimestamp = finishedAt.replace(/[:.]/g, "-");
  const evidencePath = path.join(toolingReportDir, `${safeTimestamp}-run.json`);
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return evidencePath;
}
