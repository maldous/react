import { finding } from "../vocab.mjs";
import { buildReports } from "../formal-assurance.mjs";

export default function r34ConstraintSatisfaction(ctx) {
  const report = buildReports(ctx).reports.constraintSatisfaction;
  return report.violations.map((violation) =>
    finding(
      "R34-constraint-satisfaction",
      violation.capability || violation.event,
      violation.constraint
    )
  );
}
