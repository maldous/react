import { reportFindings } from "./adversarial-usf-report-rule.mjs";

export default function r52RouteSecurityAssurance(ctx) {
  return reportFindings(ctx, "R52-route-security-assurance", "routeSecurity");
}
