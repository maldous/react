import { reportFindings } from "./adversarial-usf-report-rule.mjs";

export default function r59DataGovernanceRuntimeAssurance(ctx) {
  return reportFindings(ctx, "R59-data-governance-runtime-assurance", "dataGovernance");
}
