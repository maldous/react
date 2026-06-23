type RuntimeProofEvidenceOverrides = {
  subjectIds?: string[];
  routeIds?: string[];
  workflowIds?: string[];
  eventIds?: string[];
  storageIds?: string[];
  providerId?: string;
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

export function getRuntimeProofEvidence(): RuntimeProofEvidenceOverrides {
  return (
    (globalThis as unknown as Record<string, RuntimeProofEvidenceOverrides>)[proofEvidenceKey] || {}
  );
}

function mergeArray<T>(left: T[] | undefined, right: T[] | undefined): T[] | undefined {
  if (!left && !right) return undefined;
  return [...new Set([...(left || []), ...(right || [])])];
}
