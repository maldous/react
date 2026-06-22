import { finding } from "../vocab.mjs";
import { buildUSFAssurance } from "../usf-assurance.mjs";

export default function r48ReliabilityAssurance(ctx) {
  return buildUSFAssurance(ctx).reports.reliabilityAssurance.violations.map((violation) =>
    finding("R48-reliability-assurance", violation.capability, `missing ${violation.missing}`)
  );
}
