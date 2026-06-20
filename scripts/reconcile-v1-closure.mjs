#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";

function updateJson(path, fn) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  fn(data);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

// 1. v1-capability-closure.json
updateJson("docs/v2-foundation/v1-capability-closure.json", (caps) => {
  for (const c of caps) {
    if (c.capability === "Metrics + traces") {
      c.status = "delivered-and-proven";
      c.openAction = null;
      c.proof = "proof:metrics-prometheus; proof:dashboards";
      delete c.completionAction;
      c.closedBy = "V1-completion acceleration slice — Prometheus metrics + Grafana dashboards";
    }
    if (c.capability === "Code quality + secret + dependency scanning") {
      c.status = "delivered-and-proven";
      c.openAction = null;
      delete c.completionAction;
      c.closedBy = "V1-completion acceleration slice — authoritative security gate hardening";
    }
    if (c.capability === "i18n runtime + validation") {
      c.status = "delivered-and-proven";
      c.openAction = null;
      delete c.completionAction;
      c.closedBy =
        "V1-completion acceleration slice — React I18nProvider + hooks + ICU + hard gate";
    }
  }
});

// 2. zero-gap-reconciliation.json
updateJson("docs/v2-foundation/zero-gap-reconciliation.json", (data) => {
  // Update semantic gaps
  const remaining = data.semanticGapsRemaining.capabilities.filter(
    (c) => !["V1C-17", "V1C-18", "V1C-25"].includes(c.action)
  );
  data.semanticGapsRemaining.capabilities = remaining;
  data.semanticGapsRemaining.count = remaining.length;

  // Update branch cut blockers
  data.branchCutBlockers.capabilityCompletions = remaining.length;
  data.cutReadiness.completionBlockerCount = remaining.length + 10; // +10 deprecated packages

  data.verdict = `reconciliation updated — V1C-17, V1C-18, V1C-25 closed. ${remaining.length} capability completions + 10 deprecated packages remain.`;
});

console.log("Reconciliation complete:");
console.log("  V1C-17 (Metrics + traces) → delivered-and-proven");
console.log("  V1C-18 (Code quality + scanning) → delivered-and-proven");
console.log("  V1C-25 (i18n runtime + validation) → delivered-and-proven");
console.log("  Remaining capability blockers:", 22 - 3); // 19 remaining
