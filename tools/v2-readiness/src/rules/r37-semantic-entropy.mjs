import { finding } from "../vocab.mjs";
import { buildReports } from "../formal-assurance.mjs";

export default function r37SemanticEntropy(ctx) {
  const report = buildReports(ctx).reports.semanticEntropy;
  return report.violations.map((violation) =>
    finding(
      "R37-semantic-entropy",
      violation.id || violation.capability,
      violation.type || violation.contradiction
    )
  );
}
