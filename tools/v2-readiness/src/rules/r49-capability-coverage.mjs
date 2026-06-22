import { finding } from "../vocab.mjs";
import { buildUSFAssurance } from "../usf-assurance.mjs";

export default function r49CapabilityCoverage(ctx) {
  return buildUSFAssurance(ctx).reports.capabilityCoverage.violations.map((violation) =>
    finding("R49-capability-coverage", violation.capability, `missing ${violation.missing}`)
  );
}
