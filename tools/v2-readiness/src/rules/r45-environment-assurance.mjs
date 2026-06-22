import { finding } from "../vocab.mjs";
import { buildUSFAssurance } from "../usf-assurance.mjs";

export default function r45EnvironmentAssurance(ctx) {
  return buildUSFAssurance(ctx).reports.environmentAssurance.violations.map((violation) =>
    finding(
      "R45-environment-assurance",
      `${violation.capability}:${violation.env}`,
      `missing ${violation.missing}`
    )
  );
}
