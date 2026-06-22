import { finding } from "../vocab.mjs";
import { buildReports } from "../formal-assurance.mjs";

export default function r32TraceabilityClosure(ctx) {
  const report = buildReports(ctx).reports.traceabilityClosure;
  const out = [];
  for (const violation of report.violations)
    out.push(
      finding(
        "R32-traceability-closure",
        violation.capability,
        `capability is not traceable to ${violation.missing}`
      )
    );
  for (const violation of report.eventViolations)
    out.push(
      finding(
        "R32-traceability-closure",
        violation.event,
        `event is not traceable to ${violation.missing}`
      )
    );
  for (const subject of report.environmentViolations)
    out.push(
      finding("R32-traceability-closure", subject, "environment row does not trace to capability")
    );
  for (const subject of report.interactionViolations)
    out.push(
      finding(
        "R32-traceability-closure",
        subject,
        "interaction does not trace to a delivered capability pair"
      )
    );
  return out;
}
