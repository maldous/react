import { finding } from "../vocab.mjs";
import { buildUSFAssurance } from "../usf-assurance.mjs";

export default function r41ObservabilityAssurance(ctx) {
  return buildUSFAssurance(ctx).reports.observabilityAssurance.violations.map((violation) =>
    finding(
      "R41-observability-assurance",
      violation.capability || violation.event,
      `missing ${violation.missing}`
    )
  );
}
