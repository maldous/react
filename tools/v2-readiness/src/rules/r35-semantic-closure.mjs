import { finding } from "../vocab.mjs";
import { buildReports } from "../formal-assurance.mjs";

export default function r35SemanticClosure(ctx) {
  const report = buildReports(ctx).reports.semanticClosure;
  return report.violations.map((violation) =>
    finding(
      "R35-semantic-closure",
      violation.capability || violation.behaviour,
      violation.missing || violation.type
    )
  );
}
