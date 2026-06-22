import { reportFindings } from "./adversarial-usf-report-rule.mjs";

export default function r58MetricsAlertsAssurance(ctx) {
  return reportFindings(ctx, "R58-metrics-alerts-assurance", "metricsAlerts");
}
