import { reportFindings } from "./adversarial-usf-report-rule.mjs";

export default function r60ProviderReliabilityRuntimeAssurance(ctx) {
  return reportFindings(ctx, "R60-provider-reliability-runtime-assurance", "providerReliability");
}
