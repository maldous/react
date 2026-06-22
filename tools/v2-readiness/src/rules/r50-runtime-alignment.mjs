import { finding } from "../vocab.mjs";
import { buildUSFAssurance } from "../usf-assurance.mjs";

export default function r50RuntimeAlignment(ctx) {
  return buildUSFAssurance(ctx).reports.runtimeAlignment.violations.map((violation) =>
    finding("R50-runtime-alignment", violation.capability, `missing ${violation.missing}`)
  );
}
