import { reportFindings } from "./adversarial-usf-report-rule.mjs";

export default function r53OwnershipAssurance(ctx) {
  return reportFindings(ctx, "R53-ownership-assurance", "ownership");
}
