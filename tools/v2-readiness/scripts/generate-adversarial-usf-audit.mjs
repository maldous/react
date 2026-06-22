#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { loadContext } from "../src/load.mjs";
import { buildAdversarialUSFAudit } from "../src/adversarial-usf-audit.mjs";

const repoRoot = process.cwd();
const outDir = path.join(repoRoot, "docs/v2-foundation/usf-audit");
fs.mkdirSync(outDir, { recursive: true });

const ctx = loadContext({ repoRoot, strict: true });
const audit = buildAdversarialUSFAudit(ctx);

const writeJson = (name, value) => {
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
};

const routePriorityWeight = (route) => {
  if (route.path.startsWith("/admin")) return 1;
  if (/^\/api\/(org|organisation|tenant|orgs?|tenants?)\b/.test(route.path)) return 2;
  if (route.path.startsWith("/auth")) return 3;
  if (/storage|blob|file|object|upload|download/.test(route.path)) return 4;
  if (/workflow/.test(route.path)) return 5;
  if (/governance|policy|aud[itc]it|compliance|security|privacy/.test(route.path)) return 6;
  if (/billing|invoice|entitlement|quota/.test(route.path)) return 7;
  if (/webhook/.test(route.path)) return 8;
  if (/graph(ql)?/.test(route.path)) return 9;
  if (/health|ready|status|metrics/.test(route.path)) return 10;
  return 11;
};

const routeCategory = (route) => {
  switch (routePriorityWeight(route)) {
    case 1:
      return "admin";
    case 2:
      return "tenant";
    case 3:
      return "auth";
    case 4:
      return "storage";
    case 5:
      return "workflow";
    case 6:
      return "governance";
    case 7:
      return "billing";
    case 8:
      return "webhook";
    case 9:
      return "graphql";
    case 10:
      return "readiness";
    default:
      return "other";
  }
};

const findOwner = (capabilities, name) => {
  if (!name || name === "unknown") return "unassured";
  const match = capabilities.find((capability) => String(capability.capability) === String(name));
  return match?.ownerId ?? match?.operationalOwner ?? "unassured";
};

const routeHasString = (route, keys) =>
  keys.map((k) => route[k]).every((value) => Boolean(value && value !== "unknown"));

const safe = (value) => (value === "" || value == null ? "unassured" : value);

const buildRouteSemanticMatrix = (routes, ownershipCaps) =>
  [...routes]
    .sort((a, b) => {
      const p = routePriorityWeight(a) - routePriorityWeight(b);
      if (p !== 0) return p;
      return `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`);
    })
    .map((route) => ({
      method: route.method || "unknown",
      path: route.path || "unknown",
      category: routeCategory(route),
      capability: route.capability || "unassured",
      contractRef: route.capability || "unassured",
      permissionRef: route.permissionRequired || "unassured",
      auditRef: route.auditEvent || "unassured",
      traceRef: route.traceSpan || "unassured",
      metricRef: route.metricName || "unassured",
      logRef: route.logEvent || "unassured",
      proofRef: route.proofRef || "unassured",
      ownerRef: findOwner(ownershipCaps, route.capability),
      routeId: route.routeId,
    }));

const buildRouteObservabilityMatrix = (routes) =>
  routes.map((route) => ({
    method: route.method || "unknown",
    path: route.path || "unknown",
    sourceFile: (route.sourceFileRefs || [])[0] || "unknown",
    traceImplementation: route.traceSpan || "unassured",
    logImplementation: route.logEvent || "unassured",
    metricImplementation: route.metricName || "unassured",
    proofImplementation: route.proofRef || "unassured",
    correlationId: route.evidence?.pipelineCorrelation ? "X-Request-Id/requestId" : "unassured",
    routeId: route.routeId,
    errorLog: route.logEvent && route.logEvent.includes("failed") ? route.logEvent : "unassured",
    assured:
      routeHasString(route, ["traceSpan", "logEvent", "metricName"]) &&
      route.proofRef !== "unknown",
  }));

const buildMutationAuditMatrix = (routes, audits) =>
  audits.map((audit) => {
    const route = routes.find((route) => route.routeId === audit.routeId);
    return {
      routeId: audit.routeId,
      method: audit.method,
      path: audit.path,
      isMutation: route?.isMutation ?? false,
      auditEvent: audit.auditEvent || "unassured",
      actor: audit.actor || "unassured",
      resource: audit.resource || "unassured",
      timestamp: "unassured",
      correlation: "unassured",
      beforeState: "unassured",
      afterState: "unassured",
      traceSpan: route?.traceSpan || "unassured",
      proofRef: route?.proofRef || "unassured",
      proofExercised: route?.proofRef !== "unknown",
    };
  });

const buildCapabilityOwnershipMatrix = (ownershipRows) =>
  ownershipRows.map((capability) => ({
    capability: capability.capability,
    domainOwner: capability.owningDomain || "unassured",
    operationalOwner: capability.operationalOwner || "unassured",
    securityOwner: capability.securityOwner || "unassured",
    dataOwner: capability.dataOwner || "unassured",
    providerOwner: capability.runtimeOwner || "unassured",
    ownerType: capability.ownerType || "unassured",
    ownerId: capability.ownerId || "unassured",
  }));

const buildStorageAssuranceMatrix = (storageOps) =>
  storageOps.map((op) => ({
    operation: op.operation,
    file: op.file,
    tenantIsolation: safe(op.tenantPrefixIsolation),
    quotaEnforcement: safe(op.quotaBeforeWrite),
    uploadLifecycle: safe(op.uploadStateTransition),
    quarantine: safe(op.quarantine),
    avScan: safe(op.avScan),
    cleanOrRejectedState: safe(op.cleanRejectedLifecycle),
    legalHold: safe(op.legalHoldDeletionBlock),
    audit: safe(op.auditEvent),
    trace: safe(op.traceSpan),
    metric: safe(op.metric),
    backup: safe(op.backupExportRetentionRelationship),
    restore: safe(op.backupExportRetentionRelationship),
    proof: safe(op.proofCoverage),
    sourceFile: op.file,
    operationId: op.operationId,
  }));

const buildWorkflowAssuranceMatrix = (workflows) =>
  workflows.map((workflow) => ({
    workflow: workflow.workflow,
    file: workflow.file,
    stateMachine: safe(workflow.stateMachineDefinition),
    allowedTransitions: safe(workflow.allowedTransitions),
    forbiddenTransitions: safe(workflow.forbiddenTransitions),
    retry: safe(workflow.retry),
    timeout: safe(workflow.timeout),
    failureState: safe(workflow.failureHoldingState),
    compensation: safe(workflow.compensation),
    audit: safe(workflow.audit),
    trace: safe(workflow.trace),
    proof: safe(workflow.proofCoverage),
    operatorRecovery: safe(workflow.operatorRecovery),
  }));

const buildProviderReliabilityMatrix = (providers) =>
  providers.map((provider) => ({
    provider: provider.provider,
    adapterFile: provider.adapterFile,
    providerAdapter:
      provider.adapterFile && provider.adapterFile !== "unknown" ? "present" : "missing",
    configSource: provider.configSource,
    secretSource: provider.secretSource,
    timeout: provider.timeout,
    retry: provider.retry,
    degradedMode: provider.degradedMode,
    failClosed: provider.failClosed,
    healthCheck: provider.healthCheck,
    recoveryAction: provider.operatorRecovery,
    unavailableProof: provider.unavailableProof,
    misconfiguredProof: provider.misconfiguredProof,
    fallbackRationale: provider.fallbackRationale,
    sourceFileRefs: provider.sourceFileRefs,
  }));

const buildEventRuntimeMatrix = (events) =>
  events.map((event) => ({
    eventName: event.eventName,
    definition: safe(event.semanticDefinition),
    producer: safe(event.producer),
    consumer: safe(event.consumer),
    schema: safe(event.typedPayload),
    version: safe(event.version),
    idempotency: safe(event.idempotencyKey),
    retry: safe(event.retryPolicy),
    dlq: safe(event.dlqPolicy),
    retention: safe(event.retention),
    traceCorrelation: safe(event.correlation),
    auditRelationship: safe(event.auditRelationship),
    proof: safe(event.proofRef),
    proofExercisesPublishConsume: safe(event.proofExercisesPublishConsume),
    sourceFileRefs: event.sourceFileRefs || [],
  }));

const isNpmCommand = (command) =>
  command.kind === "npm" ||
  typeof command.command === "string" ||
  /^proof:|^e2e:|^compose:|^test/.test(command.name || command.commandId || "");

const buildCommandSemanticMatrix = (commandCatalog, commandMap, capabilities, proofs) => {
  const proofIndex = new Map(
    proofs.map((proof) => [proof.file.toLowerCase(), { proof: proof.file, level: proof.level }])
  );
  const lookup = new Set(commandCatalog.map((command) => command.name));
  const rows = [];
  for (const command of commandMap) {
    const scriptName = String(command.v1Name || "")
      .replace(/^npm /, "")
      .replace(/^make /, "");
    if (!lookup.has(scriptName) && !lookup.has(command.v1Name)) continue;
    const cat = commandCatalog.find(
      (item) => item.name === scriptName || item.name === command.v1Name
    );
    const commandName = `npm run ${scriptName}`;
    const purpose = cat?.purpose || "unassured";
    const capability =
      ctx?.capabilities?.find((cap) => (cap.capability || "").includes(scriptName))?.capability ||
      "unassured";
    const proof =
      proofs.find(
        (proof) =>
          command.command?.includes(`proof:${scriptName}`) ||
          command.command?.includes(proof.file) ||
          commandName.includes("proof:")
      )?.file || "unassured";
    const owner = "unassured";
    rows.push({
      commandId: command.v1Name || commandName,
      commandName,
      purpose,
      capability,
      proof,
      owner,
      v2Name: command.v2Name,
      source: cat?.sourceFileRefs?.[0] || "docs/v2-foundation/v1-command-catalog.json",
      proofLevel: proofIndex.get(proof?.toLowerCase())?.level,
    });
  }
  for (const item of commandCatalog.filter(
    (command) => command.kind === "npm" && isNpmCommand(command)
  )) {
    const scriptName = String(item.name).replace(/^npm /, "");
    const commandName = `npm run ${scriptName}`;
    if (
      !commandMap.some((mapping) => mapping.v1Name === item.name || mapping.v1Name === scriptName)
    )
      rows.push({
        commandId: commandName,
        commandName,
        purpose: item.purpose || "unassured",
        capability: "unassured",
        proof: "unassured",
        owner: "unassured",
        v2Name: "unassured",
        source: "docs/v2-foundation/v1-command-catalog.json",
        proofLevel: null,
      });
  }
  return rows;
};

const buildOrphanResolutionReport = (orphanReport) => ({
  totalOrphans: orphanReport?.gaps?.length || 0,
  orphanRows: (orphanReport?.gaps || []).map((orphan) => ({
    kind: orphan.kind,
    subject: orphan.subject,
    message: orphan.message,
    resolution: orphan.message.includes("no capability")
      ? "attach-to-capability"
      : "attach-to-runtime",
    action: orphan.message.includes("no capability") ? "attach" : "mark-deprecated",
    evidence: orphan.evidence || orphan,
    status: orphan.message.includes("with route mapping") ? "remove-artefact" : "attach",
  })),
});

const buildProofStrengthReport = (proofs, routes) => {
  const routeMap = new Map(routes.map((route) => [route.routeId, route.path]));
  return proofs.map((proof) => ({
    proofFile: proof.file,
    actualBehaviour: proof.assertsSideEffects
      ? "side-effect assertions"
      : "contract-only assertions",
    stateTransitions: proof.assertsSideEffects ? "covered" : "not asserted",
    failurePaths: proof.assertsFailureMode ? "covered" : "not asserted",
    liveSubstrate: proof.level >= 3 ? "attempted" : "not attempted",
    audit:
      /audit/.test(proof.classification) || proof.assertsObservabilityOrAudit
        ? "covered"
        : "not asserted",
    observability: proof.assertsObservabilityOrAudit ? "covered" : "not asserted",
    routeRefs: proof.routeRefs.map((routeId) => routeMap.get(routeId) || routeId),
  }));
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
writeJson(
  "route-semantic-matrix.json",
  buildRouteSemanticMatrix(audit.inventory.routes, audit.reports.ownership?.capabilities || [])
);
writeJson("route-observability-matrix.json", buildRouteObservabilityMatrix(audit.inventory.routes));
writeJson(
  "mutation-audit-matrix.json",
  buildMutationAuditMatrix(audit.inventory.routes, audit.inventory.audits)
);
writeJson(
  "capability-ownership-matrix.json",
  buildCapabilityOwnershipMatrix(audit.reports.ownership?.capabilities || [])
);
writeJson(
  "storage-assurance-matrix.json",
  buildStorageAssuranceMatrix(audit.inventory.storageOperations)
);
writeJson(
  "workflow-assurance-matrix.json",
  buildWorkflowAssuranceMatrix(audit.inventory.workflows)
);
writeJson(
  "provider-reliability-matrix.json",
  buildProviderReliabilityMatrix(audit.inventory.providers)
);
writeJson("event-runtime-matrix.json", buildEventRuntimeMatrix(audit.inventory.events));
writeJson(
  "command-semantic-matrix.json",
  buildCommandSemanticMatrix(
    ctx.commandCatalog,
    ctx.commandMap,
    ctx.capabilities,
    audit.inventory.proofs
  )
);
writeJson(
  "orphan-resolution-report.json",
  buildOrphanResolutionReport(audit.reports.semanticOrphan)
);
writeJson(
  "proof-strength-report.json",
  buildProofStrengthReport(audit.inventory.proofs, audit.inventory.routes)
);

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
        .map((item) => `- ${item.id}: ${item.subject} - ${item.message}`)
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
const summary = {
  status: audit.pass ? "PASS" : "FAIL",
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
PASS is not allowed unless runtime/interface-level route, security, ownership, audit, proof, storage, workflow, event, metrics, data-governance, provider, and orphan checks all have zero gaps.

| Measure | Count |
| --- | ---: |
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

## Known Gaps Identified

${mdList(backlog.slice(0, 250))}
`;
fs.writeFileSync(path.join(outDir, "adversarial-assurance-attestation.md"), attestation);

const universalPath = path.join(
  repoRoot,
  "docs/v2-foundation/universal-service-foundation-assurance.md"
);
const previousUniversal = fs.existsSync(universalPath)
  ? fs.readFileSync(universalPath, "utf8")
  : "";
const semanticSection = previousUniversal.split("\n## Known Gaps Identified\n")[0].trimEnd();
const universal = `${semanticSection}

## Adversarial Runtime Assurance

Status: ${summary.status}

The semantic USF graph is not treated as sufficient proof. Runtime-derived inventories and adversarial reports are generated under \`docs/v2-foundation/usf-audit/\`. Any unknown route-level, interface-level, provider, workflow, storage, event, ownership, proof, or orphan evidence is classified as a gap.

## Known Gaps Identified

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

See \`docs/v2-foundation/usf-audit/v1-correction-backlog.md\` for classified gaps.
`;
fs.writeFileSync(universalPath, universal);

console.log(
  `Adversarial USF audit generated in ${path.relative(repoRoot, outDir)} (${summary.status}, gaps=${backlog.length})`
);
