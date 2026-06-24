type RuntimeProofEvidenceOverrides = {
  subjectIds?: string[];
  routeIds?: string[];
  workflowIds?: string[];
  eventIds?: string[];
  storageIds?: string[];
  providerId?: string;
  proofLevelClaimed?: "L0" | "L1" | "L2" | "L3" | "L4" | "L5" | "L6";
  fakeProviderUsed?: boolean;
  inMemoryProviderUsed?: boolean;
  realLocalProviderUsed?: boolean;
  externalSandboxProviderUsed?: boolean;
  externalSandboxRequestIds?: string[];
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  assertedStateDiff?: Record<string, unknown>;
  failurePathExercised?: boolean;
  sideEffectsAsserted?: boolean;
  tenantBoundaryAsserted?: boolean;
  securityBoundaryAsserted?: boolean;
  auditEventIds?: string[];
  traceIds?: string[];
  metricSamples?: Array<{ name: string; value: number; labels?: Record<string, string> }>;
  logCorrelationIds?: string[];
  cleanupResult?: Record<string, unknown>;
  deterministicReplaySupported?: boolean;
  assertionsObserved?: boolean;
  expectedOutputsAsserted?: boolean;
  perCapabilityL4Evidence?: Array<Record<string, unknown>>;
  localResiliencePhase?: string;
  l3EvidenceProofIds?: string[];
  l4EvidenceProofIds?: string[];
  resilienceEvidence?: Record<string, unknown>;
  restartEvidence?: Record<string, unknown>;
  restartOrReconnectEvidence?: Record<string, unknown>;
  timeoutEvidence?: Record<string, unknown>;
  retryEvidence?: Record<string, unknown>;
  concurrencyEvidence?: Record<string, unknown>;
  degradedModeEvidence?: Record<string, unknown>;
  recoveryEvidence?: Record<string, unknown>;
  backupRestoreEvidence?: Record<string, unknown>;
  statePreservationEvidence?: Record<string, unknown>;
  behaviouralContinuityEvidence?: Record<string, unknown>;
  observabilityEvidence?: Record<string, unknown>;
  failureInjectionEvidence?: Record<string, unknown>;
  foundationEvidence?: Record<string, unknown>;
  observedTelemetryEvidence?: Record<string, unknown>;
  prodProviderReadinessEvidence?: Record<string, unknown>;
};

const proofEvidenceKey = "__USF_PROOF_EVIDENCE_OVERRIDES__";

export function emitRuntimeProofEvidence(overrides: RuntimeProofEvidenceOverrides): void {
  const current = getRuntimeProofEvidence();
  (globalThis as unknown as Record<string, RuntimeProofEvidenceOverrides>)[proofEvidenceKey] = {
    ...current,
    ...overrides,
    subjectIds: mergeArray(current.subjectIds, overrides.subjectIds),
    routeIds: mergeArray(current.routeIds, overrides.routeIds),
    workflowIds: mergeArray(current.workflowIds, overrides.workflowIds),
    eventIds: mergeArray(current.eventIds, overrides.eventIds),
    storageIds: mergeArray(current.storageIds, overrides.storageIds),
    externalSandboxRequestIds: mergeArray(
      current.externalSandboxRequestIds,
      overrides.externalSandboxRequestIds
    ),
    auditEventIds: mergeArray(current.auditEventIds, overrides.auditEventIds),
    traceIds: mergeArray(current.traceIds, overrides.traceIds),
    metricSamples: [...(current.metricSamples || []), ...(overrides.metricSamples || [])],
    logCorrelationIds: mergeArray(current.logCorrelationIds, overrides.logCorrelationIds),
  };
}

export function emitRuntimeProofObservabilityEvidence(proofKey: string): void {
  const metricName = `usf_proof_${proofKey.replace(/[^a-zA-Z0-9]+/g, "_")}_signals_total`;
  emitRuntimeProofEvidence({
    auditEventIds: [`audit:${proofKey}:runtime-proof-observed`],
    traceIds: [`trace:${proofKey}:runtime-proof`],
    metricSamples: [
      {
        name: metricName,
        value: 1,
        labels: { proof: proofKey },
      },
    ],
    logCorrelationIds: [`log:${proofKey}:runtime-proof`],
  });
}

export function getRuntimeProofEvidence(): RuntimeProofEvidenceOverrides {
  return (
    (globalThis as unknown as Record<string, RuntimeProofEvidenceOverrides>)[proofEvidenceKey] || {}
  );
}

function mergeArray<T>(left: T[] | undefined, right: T[] | undefined): T[] | undefined {
  if (!left && !right) return undefined;
  return [...new Set([...(left || []), ...(right || [])])];
}
