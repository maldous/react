import { reportFindings } from "./adversarial-usf-report-rule.mjs";

export default function r54ProofBehaviourAssurance(ctx) {
  return reportFindings(ctx, "R54-proof-behaviour-assurance", "proofBehaviour");
}
