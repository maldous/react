import { finding } from "../vocab.mjs";
import { buildUSFAssurance } from "../usf-assurance.mjs";

export default function r47DependencyAssurance(ctx) {
  return buildUSFAssurance(ctx).reports.dependencyAssurance.violations.map((violation) =>
    finding("R47-dependency-assurance", violation.capability, `missing ${violation.missing}`)
  );
}
