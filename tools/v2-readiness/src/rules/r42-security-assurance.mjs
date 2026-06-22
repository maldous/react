import { finding } from "../vocab.mjs";
import { buildUSFAssurance } from "../usf-assurance.mjs";

export default function r42SecurityAssurance(ctx) {
  return buildUSFAssurance(ctx).reports.securityAssurance.violations.map((violation) =>
    finding("R42-security-assurance", violation.capability, `missing ${violation.missing}`)
  );
}
