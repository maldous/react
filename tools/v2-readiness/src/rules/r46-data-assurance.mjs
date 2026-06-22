import { finding } from "../vocab.mjs";
import { buildUSFAssurance } from "../usf-assurance.mjs";

export default function r46DataAssurance(ctx) {
  return buildUSFAssurance(ctx).reports.dataAssurance.violations.map((violation) =>
    finding("R46-data-assurance", violation.capability, `missing ${violation.missing}`)
  );
}
