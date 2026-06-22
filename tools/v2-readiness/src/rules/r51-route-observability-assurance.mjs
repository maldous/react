import { reportFindings } from "./adversarial-usf-report-rule.mjs";

export default function r51RouteObservabilityAssurance(ctx) {
  return reportFindings(ctx, "R51-route-observability-assurance", "routeObservability");
}
