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
      const record = signRecord({
        proofId: metadata.proofId,
        subjectType: "runtime-proof",
        subjectIds: metadata.subjectIds || [target],
        subjectId: target,
        capabilityId: metadata.capabilityId || "unknown",
        providerId: metadata.providerId || "not-applicable",
        routeIds: [],
        workflowIds: [],
        eventIds: [],
        storageIds: [],
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
        inMemoryProviderUsed: false,
        realLocalProviderUsed: false,
        externalSandboxProviderUsed: false,
        externalSandboxRequestIds: [],
        beforeState: {},
        afterState: {},
        assertedStateDiff: {},
        failurePathExercised: false,
        sideEffectsAsserted: false,
        tenantBoundaryAsserted: false,
        securityBoundaryAsserted: false,
        auditEventIds: [],
        traceIds: [],
        metricSamples: [],
        logCorrelationIds: [],
        cleanupResult: { status: code === 0 ? "not-emitted-by-proof" : "failed" },
        deterministicReplaySupported: false,
        skipped: false,
        skipReason: null,
        generatedAt: endedAt,
        sourceFileRefs: metadata.sourceFileRefs || [target],
        evidenceEmitter: "proof-process",
        collectorRunId: metadata.collectorRunId,
        assertionsObserved: false,
        expectedOutputsAsserted: false,
      });
      fs.writeFileSync(evidenceFile, `${JSON.stringify(record, null, 2)}\n`);
    });
  }
}
