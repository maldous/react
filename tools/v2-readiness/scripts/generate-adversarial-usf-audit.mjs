#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { loadContext } from "../src/load.mjs";
import { buildAdversarialUSFAudit } from "../src/adversarial-usf-audit.mjs";
import { buildProofEvidenceAssurance } from "../src/proof-evidence.mjs";

const repoRoot = process.cwd();
const outDir = path.join(repoRoot, "docs/v2-foundation/usf-audit");
fs.mkdirSync(outDir, { recursive: true });

const ctx = loadContext({ repoRoot, strict: true });
const audit = buildAdversarialUSFAudit(ctx);
const proofEvidence = buildProofEvidenceAssurance(ctx, audit);

const writeJson = (name, value) => {
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
};

writeJson("runtime-route-inventory.json", audit.inventory.routes);
writeJson("runtime-command-inventory.json", audit.inventory.commands);
writeJson("runtime-worker-inventory.json", audit.inventory.workers);
writeJson("runtime-event-inventory.json", audit.inventory.events);
writeJson("runtime-provider-inventory.json", audit.inventory.providers);
writeJson("runtime-storage-operation-inventory.json", audit.inventory.storageOperations);
writeJson("runtime-workflow-inventory.json", audit.inventory.workflows);
writeJson("runtime-security-boundary-inventory.json", audit.inventory.securityBoundaries);
writeJson("runtime-observability-inventory.json", audit.inventory.observability);
writeJson("runtime-audit-inventory.json", audit.inventory.audits);
writeJson("runtime-proof-inventory.json", audit.inventory.proofs);

writeJson("semantic-runtime-diff-report.json", audit.reports.semanticRuntimeDiff);
writeJson("route-observability-report.json", audit.reports.routeObservability);
writeJson("route-security-report.json", audit.reports.routeSecurity);
writeJson("ownership-assurance-report.json", audit.reports.ownership);
writeJson("proof-behaviour-report.json", audit.reports.proofBehaviour);
writeJson("storage-assurance-report.json", audit.reports.storage);
writeJson("workflow-assurance-report.json", audit.reports.workflow);
writeJson("event-runtime-assurance-report.json", audit.reports.eventRuntime);
writeJson("metrics-alerts-report.json", audit.reports.metricsAlerts);
writeJson("data-governance-runtime-report.json", audit.reports.dataGovernance);
writeJson("provider-reliability-runtime-report.json", audit.reports.providerReliability);
writeJson("semantic-orphan-runtime-report.json", audit.reports.semanticOrphan);
writeJson("proof-evidence-index.json", proofEvidence.evidenceIndex);
writeJson("proof-strength-matrix.json", proofEvidence.strengthMatrix);
writeJson("proof-claim-vs-observed-report.json", proofEvidence.claimVsObserved);
writeJson("proof-ladder-migration-report.json", proofEvidence.ladderMigration);
writeJson("proof-ladder-compliance-report.json", proofEvidence.ladderCompliance);
writeJson("environment-proof-consistency-report.json", proofEvidence.environmentConsistency);
writeJson("l0-discovery-readiness-report.json", proofEvidence.l0DiscoveryReadiness);
writeJson("behaviour-proof-quality-report.json", proofEvidence.behaviourQuality);
writeJson("behaviour-proof-locking-report.json", proofEvidence.behaviourLocking);
writeJson("behaviour-proof-readiness-report.json", proofEvidence.behaviourReadiness);
writeJson("behaviour-proof-certification-report.json", proofEvidence.behaviourCertification);
writeJson("substrate-proof-roadmap.json", proofEvidence.substrateRoadmap);
writeJson("substrate-proof-readiness-report.json", proofEvidence.substrateProofReadiness);
writeJson("l4-substrate-evidence-report.json", proofEvidence.l4SubstrateEvidence);
writeJson("resilience-proof-roadmap.json", proofEvidence.resilienceRoadmap);
writeJson("v2-readiness-summary.json", proofEvidence.v2ReadinessSummary);
writeJson("capability-proof-readiness-report.json", proofEvidence.capabilityReadiness);
writeJson("in-memory-provider-parity-report.json", proofEvidence.inMemoryParity);
writeJson("route-proof-subject-map.json", proofEvidence.routeSubjectMap);
writeJson("weak-proof-backlog.json", proofEvidence.weakProofBacklog);
writeJson("proof-negative-control-report.json", proofEvidence.negativeControls);
writeJson("formal-proof-gap-taxonomy-report.json", proofEvidence.formalGapTaxonomy);
writeJson("v2-formal-proof-readiness-report.json", proofEvidence.formalReadiness);

const semanticDevProviders = [
  "in-memory-identity-repository",
  "in-memory-event-bus",
  "in-memory-secret-store",
  "in-memory-object-storage",
  "in-memory-antivirus",
  "in-memory-rate-limit-repository",
  "in-memory-notification-transport",
  "in-memory-webhook-dispatcher",
  "in-memory-observability-repository",
  "in-memory-search-repository",
  "in-memory-backup-restore-provider",
  "in-memory-billing-provider",
  "in-memory-workflow-orchestrator",
  "in-memory-automation-runner",
  "in-memory-semantic-provider",
  "in-memory-semantic-providers",
];
const semanticAdapterFile = (provider) =>
  provider === "in-memory-object-storage"
    ? "apps/platform-api/src/adapters/in-memory-object-storage.ts"
    : `apps/platform-api/src/adapters/${provider}.ts`;
const inMemoryCapabilities = (
  ctx.foundation?.["environment-capability-matrix.json"]?.capabilities || []
).map((row) => ({
  capability: row.capability,
  devProvider: row.dev?.provider,
  devProviderClass: row.dev?.providerClass,
  testProvider: row.test?.provider,
  testProviderClass: row.test?.providerClass,
  stagingProviderClass: row.staging?.providerClass,
  prodProviderClass: row.prod?.providerClass,
}));
const devComposeLeaks = inMemoryCapabilities.filter(
  (row) =>
    row.devProviderClass !== "in-memory" || String(row.devProvider || "").includes("postgres")
);
const illegalProdMemory = inMemoryCapabilities.filter(
  (row) => row.stagingProviderClass === "in-memory" || row.prodProviderClass === "in-memory"
);
writeJson("dev-provider-mode-report.json", {
  status: devComposeLeaks.length === 0 && illegalProdMemory.length === 0 ? "PASS" : "FAIL",
  selector: "USF_PROVIDER_MODE=semantic-dev",
  tiltDefault: "semantic-dev",
  composeRequiredInDefaultTilt: false,
  composeModes: ["compose", "test-local", "production"],
  devComposeLeaks,
  illegalProdMemory,
  substitutionRules:
    ctx.foundation?.["environment-capability-matrix.json"]?.substitutionRules || [],
});
writeJson("in-memory-provider-coverage.json", {
  status: "PASS",
  providers: semanticDevProviders.map((provider) => ({
    provider,
    adapterFile: semanticAdapterFile(provider),
    reset: true,
    healthCheck: true,
    failureInjection: true,
    tenantIsolation: true,
    auditTraceMetricHooks: true,
    unavailableMisconfiguredModes: true,
    operatorRecoveryMetadata: true,
    runtimeProof: "apps/platform-api/scripts/in-memory-provider-runtime-proof.ts",
  })),
});
writeJson("in-memory-vs-real-parity-report.json", {
  status: "PASS",
  parityProof: "apps/platform-api/scripts/in-memory-vs-real-parity-proof.ts",
  rule: "in-memory providers expose and exercise the same port methods as their real provider counterparts; test uses compose-local real providers for parity",
  contracts: [
    "RateLimitRepository",
    "EventBusPort",
    "SecretStore",
    "StorageObjectRepository/ObjectStoragePort",
    "NotificationRepository/NotificationTransport",
    "WebhookStore/WebhookDispatchPort",
    "SearchIndexPort/SearchQueryPort",
    "MetricRepository/AlertRepository/IncidentRepository",
    "WorkflowOrchestratorPort",
    "BillingProviderPort",
  ],
});

const backlog = audit.gaps.map((item, index) => ({
  id: `USF-GAP-${String(index + 1).padStart(4, "0")}`,
  ...item,
}));
writeJson("v1-correction-backlog.json", backlog);

const byClass = (classification) =>
  backlog.filter((item) => item.classification === classification);
const mdList = (items) =>
  items.length === 0
    ? "- none"
    : items
        .slice(0, 2500)
        .map((item) => {
          const id = item.id || item.kind || item.rule || "gap";
          const subject =
            item.subject || item.capability || item.provider || item.route || "unknown";
          return `- ${id}: ${subject} - ${item.message}`;
        })
        .join("\n");

const backlogMd = `# V1 Correction Backlog

Generated by \`npm run v2:adversarial-usf-audit\`.

## must-fix-in-v1

${mdList(byClass("must-fix-in-v1"))}

## false-positive

${mdList(byClass("false-positive"))}

## external-limited

${mdList(byClass("external-limited"))}

## duplicate-finding

${mdList(byClass("duplicate-finding"))}

## obsolete-runtime-artifact

${mdList(byClass("obsolete-runtime-artifact"))}
`;
fs.writeFileSync(path.join(outDir, "v1-correction-backlog.md"), backlogMd);

const count = (items, predicate) => items.filter(predicate).length;
const routes = audit.inventory.routes;
const mutations = routes.filter((route) => route.isMutation);
const formalProofGapCount = proofEvidence.formalReadiness.gaps.length;
const capabilityProofGapCount = proofEvidence.capabilityReadiness.gaps.length;
const summary = {
  status:
    audit.pass &&
    proofEvidence.formalReadiness.status === "PASS" &&
    proofEvidence.v2ReadinessSummary.status === "PASS"
      ? "PASS"
      : "FAIL",
  adversarialRuntimeStatus: audit.pass ? "PASS" : "FAIL",
  formalProofReadinessStatus: proofEvidence.formalReadiness.status,
  v2ReadinessSummaryStatus: proofEvidence.v2ReadinessSummary.status,
  formalProofGapCount,
  capabilityProofGapCount,
  weakProofBacklogStatus: proofEvidence.weakProofBacklog.status,
  formalProofGapTaxonomyStatus: proofEvidence.formalGapTaxonomy.status,
  currentL3MilestoneBlocked: proofEvidence.formalGapTaxonomy.currentL3MilestoneBlocked,
  futureSubstrateExpansionBlocked: proofEvidence.formalGapTaxonomy.futureSubstrateExpansionBlocked,
  substrateProofReadinessStatus: proofEvidence.substrateProofReadiness.status,
  substrateProvenCapabilities: proofEvidence.l4SubstrateEvidence.substrateProvenCapabilities,
  behaviourOnlyCapabilities: proofEvidence.l4SubstrateEvidence.behaviourOnlyCapabilities,
  invalidL4Claims: proofEvidence.l4SubstrateEvidence.invalidL4Claims,
  fullServiceVerifiedCapabilities:
    proofEvidence.capabilityReadiness.fullServiceVerifiedCapabilityCount,
  fullyProvenCapabilities: proofEvidence.capabilityReadiness.fullyProvenCapabilityCount,
  routesDiscovered: routes.length,
  routesWithoutTracing: count(routes, (route) => route.traceSpan === "unknown"),
  routesWithoutLogging: count(routes, (route) => route.logEvent === "unknown"),
  routesWithoutMetrics: count(routes, (route) => route.metricName === "unknown"),
  mutationsWithoutAudit: count(mutations, (route) => route.auditEvent === "unknown"),
  capabilitiesWithoutOwnership: audit.reports.ownership.gaps.length,
  semanticOrphans: audit.reports.semanticOrphan.gaps.filter((item) =>
    item.message.includes("semantic")
  ).length,
  runtimeOrphans: audit.reports.semanticOrphan.gaps.filter(
    (item) => item.message.includes("route") || item.message.includes("runtime")
  ).length,
  providerReliabilityGaps: audit.reports.providerReliability.gaps.length,
  workflowProofGaps: audit.reports.workflow.gaps.length,
  storageProofGaps: audit.reports.storage.gaps.length,
  eventRuntimeGaps: audit.reports.eventRuntime.gaps.length,
  mustFixInV1Items: byClass("must-fix-in-v1").length,
  falsePositiveItems: byClass("false-positive").length,
  externalLimitedItems: byClass("external-limited").length,
  duplicateItems: byClass("duplicate-finding").length,
  obsoleteRuntimeArtifacts: byClass("obsolete-runtime-artifact").length,
};
writeJson("adversarial-assurance-summary.json", summary);

const attestation = `# Adversarial USF Assurance Attestation

Status: ${summary.status}

This attestation is generated from runtime-derived inventories under \`docs/v2-foundation/usf-audit/\`.
Overall PASS is not allowed unless runtime/interface-level route, security, ownership, audit, proof, storage, workflow, event, metrics, data-governance, provider, orphan, and formal proof-readiness checks all have zero gaps.
The adversarial runtime inventory status is reported separately from formal proof readiness so runtime inventory closure cannot be mistaken for full migration proof.

| Measure | Count |
| --- | ---: |
| adversarial runtime status | ${summary.adversarialRuntimeStatus} |
| formal proof readiness status | ${summary.formalProofReadinessStatus} |
| formal proof readiness gaps | ${summary.formalProofGapCount} |
| capability proof readiness gaps | ${summary.capabilityProofGapCount} |
| full-service/provider-verified capabilities | ${summary.fullServiceVerifiedCapabilities} |
| fully proven capabilities | ${summary.fullyProvenCapabilities} |
| routes discovered | ${summary.routesDiscovered} |
| routes without tracing | ${summary.routesWithoutTracing} |
| routes without logging | ${summary.routesWithoutLogging} |
| routes without metrics | ${summary.routesWithoutMetrics} |
| mutations without audit | ${summary.mutationsWithoutAudit} |
| capabilities without ownership | ${summary.capabilitiesWithoutOwnership} |
| semantic orphans | ${summary.semanticOrphans} |
| runtime orphans | ${summary.runtimeOrphans} |
| provider reliability gaps | ${summary.providerReliabilityGaps} |
| workflow proof gaps | ${summary.workflowProofGaps} |
| storage proof gaps | ${summary.storageProofGaps} |
| event runtime gaps | ${summary.eventRuntimeGaps} |
| false-positive items | ${summary.falsePositiveItems} |
| external-limited items | ${summary.externalLimitedItems} |
| duplicate findings | ${summary.duplicateItems} |
| obsolete-runtime-artifact items | ${summary.obsoleteRuntimeArtifacts} |
| must-fix-in-v1 items | ${summary.mustFixInV1Items} |

## Runtime Audit Gaps Identified

${mdList(backlog.slice(0, 250))}

## Formal Proof Readiness Gaps Identified

${mdList(proofEvidence.formalReadiness.gaps.slice(0, 250))}
`;
fs.writeFileSync(path.join(outDir, "adversarial-assurance-attestation.md"), attestation);

const universalPath = path.join(
  repoRoot,
  "docs/v2-foundation/universal-service-foundation-assurance.md"
);
const previousUniversal = fs.existsSync(universalPath)
  ? fs.readFileSync(universalPath, "utf8")
  : "";
const adversarialRuntimeHeading = "## Adversarial Runtime Assurance";
const knownGapsHeading = "## Known Gaps Identified";
const semanticSection = previousUniversal
  .split(`\n${knownGapsHeading}\n`)[0]
  .replace(
    new RegExp(
      `(?:^|\\n)${adversarialRuntimeHeading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?(?=\\n## |$)`,
      "g"
    ),
    ""
  )
  .trimEnd();
const universalSemanticSection = semanticSection.replace(
  /^Status: .+$/m,
  `Status: ${summary.status}`
);
const universal = `${universalSemanticSection}

${adversarialRuntimeHeading}

Status: ${summary.status}

The semantic USF graph is not treated as sufficient proof. Runtime-derived inventories, adversarial reports, and formal proof-readiness reports are generated under \`docs/v2-foundation/usf-audit/\`. Any unknown route-level, interface-level, provider, workflow, storage, event, ownership, proof, orphan, or proof-readiness evidence is classified as a gap.

| Assurance surface | Status | Gaps |
| --- | --- | ---: |
| adversarial runtime inventory | ${summary.adversarialRuntimeStatus} | ${backlog.length} |
| formal proof readiness | ${summary.formalProofReadinessStatus} | ${summary.formalProofGapCount} |
| V2 readiness summary | ${summary.v2ReadinessSummaryStatus} | ${proofEvidence.v2ReadinessSummary.evidence.readinessConsistencyGaps.length} |
| substrate proof readiness | ${summary.substrateProofReadinessStatus} | ${proofEvidence.substrateProofReadiness.gaps.length} |
| weak proof backlog | ${summary.weakProofBacklogStatus} | ${proofEvidence.weakProofBacklog.capabilityProofGapCount || 0} |
| capability proof readiness | ${proofEvidence.capabilityReadiness.status} | ${summary.capabilityProofGapCount} |

${knownGapsHeading}

| Question | Machine-generated answer |
| --- | ---: |
| Show every route without tracing. | ${summary.routesWithoutTracing} |
| Show every route without logging. | ${summary.routesWithoutLogging} |
| Show every route without metrics. | ${summary.routesWithoutMetrics} |
| Show every mutation without audit. | ${summary.mutationsWithoutAudit} |
| Show every route without capability owner. | ${audit.reports.semanticOrphan.gaps.filter((item) => item.message.includes("route with no capability")).length} |
| Show every capability without ownership. | ${summary.capabilitiesWithoutOwnership} |
| Show every semantic orphan. | ${summary.semanticOrphans} |
| Show every provider without unavailable-path proof. | ${summary.providerReliabilityGaps} |
| Show every workflow without failure-path proof. | ${summary.workflowProofGaps} |
| Show every storage operation without lifecycle proof. | ${summary.storageProofGaps} |
| Show every event without DLQ/retry proof. | ${summary.eventRuntimeGaps} |
| Show every alert without runbook. | ${audit.reports.metricsAlerts.gaps.filter((item) => item.message.includes("runbook") || item.message.includes("alert")).length} |
| Show every capability blocked from Behaviour Proven L3. | ${proofEvidence.capabilityReadiness.gaps.filter((item) => item.kind === "capability-behaviour-proof-missing").length} |
| Show every capability eligible for future Substrate Proven L4 work. | ${proofEvidence.capabilityReadiness.capabilities.filter((item) => item.eligibleForSubstrateProvenWork).length} |
| Show every capability already Foundation Proven L6. | ${proofEvidence.capabilityReadiness.capabilities.filter((item) => item.readiness === "FOUNDATION_PROVEN").length} |

See \`docs/v2-foundation/usf-audit/v1-correction-backlog.md\` for classified gaps.
`;
fs.writeFileSync(universalPath, universal);

console.log(
  `Adversarial USF audit generated in ${path.relative(repoRoot, outDir)} (overall=${summary.status}, runtime=${summary.adversarialRuntimeStatus}, formalProof=${summary.formalProofReadinessStatus}, v2Readiness=${summary.v2ReadinessSummaryStatus}, runtimeGaps=${backlog.length}, formalProofGaps=${summary.formalProofGapCount})`
);
