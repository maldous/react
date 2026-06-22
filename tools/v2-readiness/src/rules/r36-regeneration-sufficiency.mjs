import { finding } from "../vocab.mjs";
import { buildReports } from "../formal-assurance.mjs";

export default function r36RegenerationSufficiency(ctx) {
  const report = buildReports(ctx).reports.regenerationSufficiency;
  return [
    ...report.missingKnowledge.map((violation) =>
      finding(
        "R36-regeneration-sufficiency",
        violation.capability,
        `regeneration requires missing knowledge: ${violation.missing}`
      )
    ),
    ...report.implicitAssumptions.map((violation) =>
      finding("R36-regeneration-sufficiency", violation.subject, violation.message)
    ),
    ...report.undocumentedBehaviour.map((violation) =>
      finding("R36-regeneration-sufficiency", violation.subject, violation.message)
    ),
  ];
}
