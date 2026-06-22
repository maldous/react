import { finding } from "../vocab.mjs";
import { buildUSFAssurance } from "../usf-assurance.mjs";

export default function r44EventAssurance(ctx) {
  return buildUSFAssurance(ctx).reports.eventAssurance.violations.map((violation) =>
    finding("R44-event-assurance", violation.event, `missing ${violation.missing}`)
  );
}
