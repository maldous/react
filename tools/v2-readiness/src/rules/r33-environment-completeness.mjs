import { finding } from "../vocab.mjs";
import { buildReports } from "../formal-assurance.mjs";

export default function r33EnvironmentCompleteness(ctx) {
  const report = buildReports(ctx).reports.environmentCompleteness;
  return report.violations.map((violation) =>
    finding(
      "R33-environment-completeness",
      violation.capability,
      violation.env ? `${violation.type}: ${violation.env}` : violation.type
    )
  );
}
