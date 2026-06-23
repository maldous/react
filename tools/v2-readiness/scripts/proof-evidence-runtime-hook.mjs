import fs from "node:fs";
import { signRecord } from "../src/proof-evidence.mjs";

const evidenceFile = process.env.USF_PROOF_EVIDENCE_FILE;
const rawMetadata = process.env.USF_PROOF_EVIDENCE_METADATA;

if (evidenceFile && rawMetadata) {
  const metadata = JSON.parse(rawMetadata);
  const startedAt = new Date().toISOString();
  const target = metadata.proofFile;
  const isTargetProofProcess = process.argv.some((arg) => arg.endsWith(target));

  if (isTargetProofProcess) {
    process.on("exit", (code) => {
      const endedAt = new Date().toISOString();
      const providerMode = process.env.USF_PROVIDER_MODE || process.env.PROVIDER_MODE || "unknown";
      const environmentMode =
        process.env.USF_ENVIRONMENT_MODE ||
        process.env.NODE_ENV ||
        process.env.APP_ENV ||
        "unknown";
      const proofOverrides = globalThis.__USF_PROOF_EVIDENCE_OVERRIDES__ || {};
      const record = signRecord({
        proofId: metadata.proofId,
        subjectType: "runtime-proof",
        subjectIds: unique([
          ...(metadata.subjectIds || [target]),
          ...(proofOverrides.subjectIds || []),
        ]),
        subjectId: target,
        capabilityId: metadata.capabilityId || "unknown",
        providerId: proofOverrides.providerId || metadata.providerId || "not-applicable",
        routeIds: proofOverrides.routeIds || [],
        workflowIds: proofOverrides.workflowIds || [],
        eventIds: proofOverrides.eventIds || [],
        storageIds: proofOverrides.storageIds || [],
        environmentMode,
        providerMode,
        proofLevelClaimed: metadata.proofLevelClaimed || "L0",
        commandExecuted: metadata.commandExecuted,
        startedAt,
        endedAt,
        exitStatus: Number.isInteger(code) ? code : 0,
        commit: metadata.currentCommit,
        realImplementationPathExecuted: target,
        mockProviderUsed: providerMode === "mock",
        fakeProviderUsed: providerMode === "fake-http",
        inMemoryProviderUsed: proofOverrides.inMemoryProviderUsed === true,
        realLocalProviderUsed: proofOverrides.realLocalProviderUsed === true,
        externalSandboxProviderUsed: proofOverrides.externalSandboxProviderUsed === true,
        externalSandboxRequestIds: proofOverrides.externalSandboxRequestIds || [],
        beforeState: proofOverrides.beforeState || {},
        afterState: proofOverrides.afterState || {},
        assertedStateDiff: proofOverrides.assertedStateDiff || {},
        failurePathExercised: proofOverrides.failurePathExercised === true,
        sideEffectsAsserted: proofOverrides.sideEffectsAsserted === true,
        tenantBoundaryAsserted: proofOverrides.tenantBoundaryAsserted === true,
        securityBoundaryAsserted: proofOverrides.securityBoundaryAsserted === true,
        auditEventIds: proofOverrides.auditEventIds || [],
        traceIds: proofOverrides.traceIds || [],
        metricSamples: proofOverrides.metricSamples || [],
        logCorrelationIds: proofOverrides.logCorrelationIds || [],
        cleanupResult: proofOverrides.cleanupResult || {
          status: code === 0 ? "not-emitted-by-proof" : "failed",
        },
        deterministicReplaySupported: proofOverrides.deterministicReplaySupported === true,
        skipped: false,
        skipReason: null,
        generatedAt: endedAt,
        sourceFileRefs: metadata.sourceFileRefs || [target],
        evidenceEmitter: "proof-process",
        collectorRunId: metadata.collectorRunId,
        assertionsObserved: proofOverrides.assertionsObserved === true,
        expectedOutputsAsserted: proofOverrides.expectedOutputsAsserted === true,
      });
      fs.writeFileSync(evidenceFile, `${JSON.stringify(record, null, 2)}\n`);
    });
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
