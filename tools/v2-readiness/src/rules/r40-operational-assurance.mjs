import { finding } from "../vocab.mjs";
import { buildUSFAssurance } from "../usf-assurance.mjs";

export default function r40OperationalAssurance(ctx) {
  return buildUSFAssurance(ctx).reports.operationalAssurance.violations.map((violation) =>
    finding("R40-operational-assurance", violation.capability, `missing ${violation.missing}`)
  );
}
