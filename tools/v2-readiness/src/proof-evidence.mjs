import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { stableId } from "./formal-assurance.mjs";

export const PROOF_LEVELS = [
  {
    level: 0,
    id: "L0",
    name: "Discovery Proven",
    purpose: "inventory confidence only; no execution guarantees",
  },
  {
    level: 1,
    id: "L1",
    name: "Executable Proven",
    purpose: "execution confidence only; no behavioural guarantees",
  },
  {
    level: 2,
    id: "L2",
    name: "Contract Proven",
    purpose: "contract confidence; no state-transition guarantees",
  },
  {
    level: 3,
    id: "L3",
    name: "Behaviour Proven",
    purpose: "behavioural confidence and current programme closure target",
  },
  {
    level: 4,
    id: "L4",
    name: "Substrate Proven",
    purpose: "implementation correctness confidence against real local substrate",
  },
  {
    level: 5,
    id: "L5",
    name: "Resilience Proven",
    purpose: "operational survivability confidence",
  },
  {
    level: 6,
    id: "L6",
    name: "Foundation Proven",
    purpose: "USF primitives proven sufficient for production-grade services",
  },
];

export const PROOF_LADDER_MIGRATION = [
  {
    level: "L0",
    oldClassification: "declaration only",
    newClassification: "Discovery Proven",
    rationale:
      "L0 is retained as non-executable inventory confidence covering discovered capabilities, routes, workflows, providers, storage, events, ownership, and dependencies.",
  },
  {
    level: "L1",
    oldClassification: "schema/contract shape",
    newClassification: "Executable Proven",
    rationale:
      "Successful proof command execution is now separated from contract confidence so no-crash evidence is not overstated.",
  },
  {
    level: "L2",
    oldClassification: "unit behaviour",
    newClassification: "Contract Proven",
    rationale:
      "L2 now means interface/input/output/permission/invariant contract exercise only; state transitions belong to L3.",
  },
  {
    level: "L3",
    oldClassification: "state transition + side effects",
    newClassification: "Behaviour Proven",
    rationale:
      "L3 is expanded into the explicit behavioural closure target: before/after state, state diff, side effects, failure path, audit/metric/trace, tenant/security boundaries, and deterministic replay.",
  },
  {
    level: "L4",
    oldClassification: "local real substrate",
    newClassification: "Substrate Proven",
    rationale:
      "L4 remains real local substrate confidence but is now gated by complete L3 behavioural evidence.",
  },
  {
    level: "L5",
    oldClassification: "external sandbox/provider",
    newClassification: "Resilience Proven",
    rationale:
      "L5 no longer means external sandbox alone; it requires L4 plus restart, timeout, retry, concurrency, recovery, backup/restore, degraded-mode, and failure-injection evidence.",
  },
  {
    level: "L6",
    oldClassification: "end-to-end journey",
    newClassification: "Foundation Proven",
    rationale:
      "L6 is now full foundation assurance: L5 plus tenancy, security, observability, operational recovery, lifecycle governance, and ownership.",
  },
];

export const ENVIRONMENT_PROOF_MODEL = {
  dev: {
    purpose: "Semantic capability development",
    providerModes: ["semantic-dev", "in-memory"],
    minStrictProviderLevel: 0,
    maxLevel: 3,
    forbiddenLevels: ["L4", "L5", "L6"],
  },
  test: {
    purpose: "Substrate validation after L3 closure",
    providerModes: ["compose-local", "hermetic", "route-contract"],
    minStrictProviderLevel: 4,
    maxLevel: 4,
    forbiddenLevels: ["L5", "L6"],
  },
  staging: {
    purpose: "Resilience and production-rehearsal assurance after L3/L4 closure",
    providerModes: ["external-sandbox", "sandbox-external", "compose-local", "prod-shaped-sandbox"],
    minStrictProviderLevel: 5,
    maxLevel: 5,
    forbiddenLevels: ["L6 unless complete journey evidence is emitted"],
  },
  prod: {
    purpose: "Operational assurance",
    providerModes: ["live-readiness", "production-readiness"],
    minStrictProviderLevel: 0,
    maxLevel: 1,
    forbiddenLevels: ["L2", "L3", "L4", "L5", "L6"],
  },
  e2e: {
    purpose: "Dedicated end-to-end journey assurance",
    providerModes: ["e2e", "external-sandbox", "prod-shaped-sandbox"],
    minStrictProviderLevel: 6,
    maxLevel: 6,
    forbiddenLevels: [],
  },
};

const L5_RESILIENCE_SUBSTRATES = [
  "Postgres",
  "Redis",
  "MinIO",
  "OpenBao",
  "Keycloak",
  "Temporal",
  "Windmill",
  "Observability stack",
];

export const PROOF_EVIDENCE_DIR = "docs/v2-foundation/usf-audit/proof-evidence";

export const LEGACY_ROUTE_PROOF_ALIASES = {
  "proof:route-contracts": [
    "platform-config + config-contracts tests",
    "members unit + substrate tests",
    "openapi:drift (not complete)",
    "audit unit tests",
    "theme + platform-config tests",
    "make all (e2e gates)",
  ],
  "proof:tenant-domain-canonical": ["proof:tenant-domain-canonical (local routing only)"],
  "proof:ui-semantic-claim-mapping": ["proof:ui-semantic-claim-mapping (headless journey)"],
  "proof:ui-semantic-groups": ["proof:ui-semantic-groups (headless journey)"],
  "proof:ui-semantic-sub-organisations": ["proof:ui-semantic-sub-organisations (headless journey)"],
};

export const PROOF_EVIDENCE_REQUIRED_FIELDS = [
  "proofId",
  "subjectType",
  "subjectIds",
  "subjectId",
  "capabilityId",
  "providerId",
  "routeIds",
  "workflowIds",
  "eventIds",
  "storageIds",
  "environmentMode",
  "environment",
  "providerMode",
  "proofLevelClaimed",
  "proofLevelObserved",
  "commandExecuted",
  "startedAt",
  "startTime",
  "endedAt",
  "endTime",
  "exitStatus",
  "commit",
  "gitCommit",
  "executionTimestamp",
  "realImplementationPathExecuted",
  "mockProviderUsed",
  "fakeProviderUsed",
  "inMemoryProviderUsed",
  "realLocalProviderUsed",
  "externalSandboxProviderUsed",
  "externalSandboxRequestIds",
  "beforeState",
  "afterState",
  "assertedStateDiff",
  "stateDiff",
  "failurePathExercised",
  "failureMode",
  "sideEffectsAsserted",
  "tenantBoundaryAsserted",
  "securityBoundaryAsserted",
  "auditEventIds",
  "auditIds",
  "traceIds",
  "metricSamples",
  "metricEvidence",
  "logCorrelationIds",
  "logEvidence",
  "cleanupResult",
  "deterministicReplaySupported",
  "skipped",
  "skipReason",
  "generatedAt",
  "sourceFileRefs",
  "evidenceEmitter",
  "collectorRunId",
  "assertionsObserved",
  "expectedOutputsAsserted",
  "evidenceSignature",
];

export function proofLevelId(value) {
  const n = proofLevelNumber(value);
  return `L${n}`;
}

export function proofLevelNumber(value) {
  const text = String(value ?? "L0");
  const match = /^L?([0-6])$/.exec(text);
  return match ? Number(match[1]) : 0;
}

export function proofEvidenceSchema() {
  return {
    schemaVersion: 2,
    title: "USF runtime proof evidence",
    required: PROOF_EVIDENCE_REQUIRED_FIELDS,
    proofLevels: PROOF_LEVELS,
    evidenceDirectory: PROOF_EVIDENCE_DIR,
    fields: Object.fromEntries(
      PROOF_EVIDENCE_REQUIRED_FIELDS.map((field) => [
        field,
        {
          required: true,
          description: `Mandatory machine-verifiable proof evidence field: ${field}`,
        },
      ])
    ),
  };
}

export function evidenceSignature(record) {
  const clone = { ...record };
  delete clone.evidenceSignature;
  delete clone.evidenceFile;
  delete clone.proofLevelObserved;
  if (Array.isArray(clone.subjectIds)) clone.subjectIds = [...clone.subjectIds].sort();
  return crypto.createHash("sha256").update(canonicalJson(clone)).digest("hex");
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildProofEvidenceAssurance(ctx, audit) {
  const requiredProofs = requiredRuntimeProofs(ctx, audit);
  const routeSubjectMap = buildRouteProofSubjectMap(audit);
  const evidence = buildEvidenceIndex(ctx, requiredProofs, routeSubjectMap);
  const strengthMatrix = buildStrengthMatrix(evidence.records);
  const claimVsObserved = buildClaimVsObservedReport(evidence.records);
  const ladderCompliance = buildProofLadderComplianceReport(evidence.records);
  const environmentConsistency = buildEnvironmentProofConsistencyReport(evidence.records);
  const ladderMigration = buildProofLadderMigrationReport();
  const behaviourQuality = buildBehaviourProofQualityReport(ctx, evidence.records);
  const behaviourLocking = buildBehaviourProofLockingReport(evidence.records);
  const l0DiscoveryReadiness = buildL0DiscoveryReadinessReport(ctx, evidence.records);
  const behaviourReadiness = buildBehaviourProofReadinessReport(
    ctx,
    evidence.records,
    behaviourQuality,
    l0DiscoveryReadiness
  );
  let l4SubstrateEvidence = buildL4SubstrateEvidenceReport({
    ctx,
    records: evidence.records,
    l0DiscoveryReadiness,
  });
  const capabilityReadiness = buildCapabilityProofReadinessReport(
    ctx,
    evidence.records,
    l0DiscoveryReadiness,
    l4SubstrateEvidence
  );
  l4SubstrateEvidence = buildL4SubstrateEvidenceReport({
    ctx,
    records: evidence.records,
    l0DiscoveryReadiness,
    capabilityReadiness,
  });
  const behaviourCertification = buildBehaviourProofCertificationReport({
    behaviourQuality,
    behaviourLocking,
    behaviourReadiness,
    capabilityReadiness,
    ladderCompliance,
    environmentConsistency,
    claimVsObserved,
  });
  const substrateRoadmap = buildSubstrateProofRoadmap({
    ctx,
    records: evidence.records,
    capabilityReadiness,
    behaviourCertification,
  });
  const substrateProofReadiness = buildSubstrateProofReadinessReport({
    l4SubstrateEvidence,
    capabilityReadiness,
    strengthMatrix,
    ladderCompliance,
  });
  const resilienceRoadmap = buildResilienceProofRoadmap({
    ctx,
    capabilityReadiness,
    l4SubstrateEvidence,
    substrateRoadmap,
  });
  const l5ResilienceEvidence = buildL5ResilienceEvidenceReport({
    ctx,
    records: evidence.records,
    capabilityReadiness,
    l4SubstrateEvidence,
  });
  const resilienceReadiness = buildResilienceReadinessReport({
    ctx,
    capabilityReadiness,
    l4SubstrateEvidence,
    l5ResilienceEvidence,
    resilienceRoadmap,
  });
  const inMemoryParity = buildInMemoryProviderParityReport(ctx, evidence.records);
  const weakProofBacklog = buildWeakProofBacklog(
    requiredProofs,
    evidence,
    claimVsObserved,
    capabilityReadiness
  );
  const negativeControls = buildNegativeControlReport(ctx);
  const formalGapTaxonomy = buildFormalProofGapTaxonomyReport({
    evidence,
    claimVsObserved,
    ladderCompliance,
    environmentConsistency,
    behaviourLocking,
    behaviourReadiness,
    capabilityReadiness,
    inMemoryParity,
    routeSubjectMap,
    l0DiscoveryReadiness,
    negativeControls,
  });
  const formalReadiness = buildFormalProofReadinessReport({
    evidence,
    strengthMatrix,
    claimVsObserved,
    ladderCompliance,
    environmentConsistency,
    ladderMigration,
    l0DiscoveryReadiness,
    behaviourQuality,
    behaviourLocking,
    behaviourReadiness,
    behaviourCertification,
    substrateRoadmap,
    substrateProofReadiness,
    resilienceRoadmap,
    resilienceReadiness,
    l5ResilienceEvidence,
    capabilityReadiness,
    inMemoryParity,
    routeSubjectMap,
    weakProofBacklog,
    negativeControls,
    formalGapTaxonomy,
  });
  const v2ReadinessSummary = buildV2ReadinessSummary({
    behaviourReadiness,
    capabilityReadiness,
    formalGapTaxonomy,
    substrateRoadmap,
    substrateProofReadiness,
    resilienceRoadmap,
    resilienceReadiness,
    l5ResilienceEvidence,
    l4SubstrateEvidence,
    strengthMatrix,
    ladderCompliance,
    l0DiscoveryReadiness,
  });

  return {
    schema: proofEvidenceSchema(),
    requiredProofs,
    evidenceIndex: evidence,
    strengthMatrix,
    claimVsObserved,
    ladderCompliance,
    environmentConsistency,
    ladderMigration,
    l0DiscoveryReadiness,
    behaviourQuality,
    behaviourLocking,
    behaviourReadiness,
    behaviourCertification,
    substrateRoadmap,
    substrateProofReadiness,
    resilienceRoadmap,
    resilienceReadiness,
    l5ResilienceEvidence,
    l4SubstrateEvidence,
    capabilityReadiness,
    inMemoryParity,
    routeSubjectMap,
    weakProofBacklog,
    negativeControls,
    formalGapTaxonomy,
    formalReadiness,
    v2ReadinessSummary,
    gaps: formalReadiness.gaps,
  };
}

export function requiredRuntimeProofs(ctx, audit) {
  const packageScripts = ctx.packageJsonScripts || {};
  const fromAudit = (audit.inventory.proofs || []).map((proof) => {
    const scriptName = proofAliasForScript(proof.file, packageScripts);
    return {
      ...proof,
      proofId: proof.proofId || stableId("proof", proof.file),
      file: proof.file,
      subjectIds: uniq([
        proof.file,
        ...(proof.subjectRefs || []),
        scriptName ? `package.json#${scriptName}` : null,
        ...proofSubjectAliases(scriptName),
        ...(proof.subjectRefs || []).flatMap((ref) => proofSubjectAliases(ref)),
      ]),
      commandExecuted:
        (scriptName && `npm run ${scriptName}`) ||
        `node --loader "$(pwd)/apps/platform-api/loader.mjs" ${proof.file}`,
      proofLevelClaimed: proofLevelId(proof.level),
      routeIds: proof.routeRefs || [],
      sourceFileRefs: proof.sourceFileRefs || [proof.file],
    };
  });
  const existingFiles = new Set(fromAudit.map((proof) => proof.file));
  const fromPackageScripts = Object.entries(packageScripts)
    .map(([name, command]) => {
      if (!name.startsWith("proof:")) return null;
      const file = proofTargetForPackageScript(command);
      if (!file || existingFiles.has(file)) return null;
      return {
        proofId: stableId("proof", file),
        file,
        subjectIds: uniq([file, `package.json#${name}`, name, ...proofSubjectAliases(name)]),
        commandExecuted: `npm run ${name}`,
        proofLevelClaimed:
          file.includes("in-memory-vs-real-parity-proof") ||
          file.includes("apps/platform-api/scripts/")
            ? "L3"
            : "L1",
        routeIds: [],
        sourceFileRefs: [file],
      };
    })
    .filter(Boolean);
  return [...fromAudit, ...fromPackageScripts].sort((a, b) => a.file.localeCompare(b.file));
}

function proofTargetForPackageScript(command) {
  const text = String(command);
  return (
    text.match(/apps\/platform-api\/scripts\/[^\s"'`]+\.ts/)?.[0] ||
    text.match(/tools\/ui-reference-harness\/playwright\/[^\s"'`]+\.spec\.ts/)?.[0] ||
    null
  );
}

function proofSubjectAliases(subject) {
  return LEGACY_ROUTE_PROOF_ALIASES[subject] || [];
}

function buildEvidenceIndex(ctx, requiredProofs, routeSubjectMap) {
  const records = readEvidenceRecords(ctx.repoRoot).map((record) =>
    normalizeEvidenceRecord(record)
  );
  const bySubject = new Map();
  for (const record of records) {
    for (const subject of record.subjectIds || []) {
      if (!bySubject.has(subject)) bySubject.set(subject, []);
      bySubject.get(subject).push(record);
    }
  }

  const required = requiredProofs.map((proof) => {
    const matches = proof.subjectIds.flatMap((subject) => bySubject.get(subject) || []);
    const record = matches.find((candidate) => candidate.subjectIds.includes(proof.file)) || null;
    return {
      proofId: proof.proofId,
      file: proof.file,
      commandExecuted: proof.commandExecuted,
      proofLevelClaimed: proof.proofLevelClaimed,
      evidenceFound: Boolean(record),
      evidenceProofId: record?.proofId || null,
      observedLevel: record?.proofLevelObserved || "L0",
    };
  });

  const validation = validateEvidenceSet({
    ctx,
    records,
    requiredProofs,
    routeSubjectMap,
    allowNegativeControls: false,
  });

  return {
    artefact: "proof-evidence-index",
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    evidenceDirectory: PROOF_EVIDENCE_DIR,
    currentCommit: ctx.headCommit,
    status: validation.gaps.length === 0 ? "PASS" : "FAIL",
    schema: proofEvidenceSchema(),
    requiredProofCount: requiredProofs.length,
    recordCount: records.length,
    required,
    gaps: validation.gaps,
    missingEvidence: validation.gaps.filter((gap) => gap.kind === "missing-evidence"),
    staleEvidence: validation.gaps.filter((gap) => gap.kind === "stale-evidence"),
    records: records.sort((a, b) => a.subjectId.localeCompare(b.subjectId)),
  };
}

export function readEvidenceRecords(repoRoot) {
  const dir = path.join(repoRoot || process.cwd(), PROOF_EVIDENCE_DIR);
  if (!fs.existsSync(dir)) return [];
  return walkFiles(dir)
    .filter(
      (file) =>
        file.endsWith(".json") &&
        !path.basename(file).startsWith("_") &&
        !file.includes(`${path.sep}negative-controls${path.sep}`)
    )
    .map((file) => {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return { ...parsed, evidenceFile: path.relative(repoRoot || process.cwd(), file) };
    });
}

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    if (entry.isFile()) out.push(full);
  }
  return out;
}

export function normalizeEvidenceRecord(record) {
  const subjectIds = uniq(record.subjectIds || [record.subjectId].filter(Boolean));
  const observed = proofLevelId(observedLevelFromEvidence(record));
  const environmentMode = record.environmentMode || record.environment || "unknown";
  const startedAt = record.startedAt || record.startTime || null;
  const endedAt = record.endedAt || record.endTime || null;
  const commit = record.commit || record.gitCommit || null;
  const assertedStateDiff = record.assertedStateDiff || record.stateDiff || {};
  const auditEventIds = record.auditEventIds || record.auditIds || [];
  const metricSamples = record.metricSamples || record.metricEvidence || [];
  const logCorrelationIds = record.logCorrelationIds || record.logEvidence || [];
  return {
    ...record,
    subjectIds,
    subjectId: record.subjectId || subjectIds[0] || record.proofId || "unknown",
    environmentMode,
    environment: record.environment || environmentMode,
    routeIds: record.routeIds || [],
    workflowIds: record.workflowIds || [],
    eventIds: record.eventIds || [],
    storageIds: record.storageIds || [],
    auditEventIds,
    auditIds: record.auditIds || auditEventIds,
    traceIds: record.traceIds || [],
    metricSamples,
    metricEvidence: record.metricEvidence || metricSamples,
    logCorrelationIds,
    logEvidence: record.logEvidence || logCorrelationIds,
    externalSandboxRequestIds: record.externalSandboxRequestIds || [],
    sourceFileRefs: record.sourceFileRefs || [],
    evidenceEmitter: record.evidenceEmitter || "unknown",
    collectorRunId: record.collectorRunId || null,
    assertionsObserved: record.assertionsObserved === true,
    expectedOutputsAsserted: record.expectedOutputsAsserted === true,
    proofLevelClaimed: proofLevelId(record.proofLevelClaimed),
    proofLevelObserved: record.proofLevelObserved || observed,
    startedAt,
    startTime: record.startTime || startedAt,
    endedAt,
    endTime: record.endTime || endedAt,
    commit,
    gitCommit: record.gitCommit || commit,
    executionTimestamp: record.executionTimestamp || record.generatedAt || endedAt,
    assertedStateDiff,
    stateDiff: record.stateDiff || assertedStateDiff,
    failureMode:
      record.failureMode || (record.failurePathExercised === true ? "exercised" : "not-exercised"),
  };
}

export function validateEvidenceSet({
  ctx,
  records,
  requiredProofs = [],
  routeSubjectMap = { routes: [] },
  allowNegativeControls = false,
}) {
  const gaps = [];
  const bySubject = new Map();
  for (const record of records) {
    for (const subject of record.subjectIds || []) {
      if (!bySubject.has(subject)) bySubject.set(subject, []);
      bySubject.get(subject).push(record);
    }
    validateRecordShape(record, gaps, ctx, allowNegativeControls);
  }

  for (const proof of requiredProofs) {
    const matches = proof.subjectIds.flatMap((subject) => bySubject.get(subject) || []);
    if (matches.length === 0) {
      gaps.push({
        kind: "missing-evidence",
        subject: proof.file,
        message: "required runtime proof has no emitted evidence JSON",
      });
      continue;
    }
    if (!matches.some((record) => record.commandExecuted === proof.commandExecuted)) {
      gaps.push({
        kind: "command-mismatch",
        subject: proof.file,
        message: "evidence exact command does not match the inventoried proof command",
      });
    }
  }

  for (const route of routeSubjectMap.routes || []) {
    if (route.proofRefs.length === 0) continue;
    const matching = route.proofRefs.flatMap((ref) => bySubject.get(ref) || []);
    if (matching.length === 0) {
      gaps.push({
        kind: "route-proof-evidence-missing",
        subject: `${route.method} ${route.path}`,
        message: "route proof has explicit subject refs but no emitted evidence record",
      });
    }
    if (route.proofRefs.some((ref) => ref === "/" || ref.endsWith("/*"))) {
      gaps.push({
        kind: "broad-route-mapping",
        subject: `${route.method} ${route.path}`,
        message: "broad route proof mapping is forbidden",
      });
    }
    if (route.mutationBeforeAfterRequired) {
      const hasState = matching.some((record) => hasMutationRouteStateEvidence(record, route));
      if (!hasState) {
        gaps.push({
          kind: "mutation-state-evidence",
          subject: `${route.method} ${route.path}`,
          message:
            "mutation proof lacks emitted route-specific before/after state and asserted diff evidence",
        });
      }
    }
  }

  return { gaps };
}

function validateRecordShape(record, gaps, ctx, allowNegativeControls) {
  for (const field of PROOF_EVIDENCE_REQUIRED_FIELDS) {
    if (!(field in record)) {
      gaps.push({
        kind: "proof-evidence-schema",
        subject: record.subjectId || record.proofId || "<unknown>",
        message: `proof evidence missing ${field}`,
      });
    }
  }
  if (record.evidenceSignature && record.evidenceSignature !== evidenceSignature(record)) {
    gaps.push({
      kind: "evidence-signature-invalid",
      subject: record.subjectId,
      message: "proof evidence signature does not match the structured payload",
    });
  }
  if (record.evidenceEmitter !== "proof-process" && !allowNegativeControls) {
    gaps.push({
      kind: "collector-fabricated-evidence",
      subject: record.subjectId,
      message: "proof evidence must be emitted by the executed proof process",
    });
  }
  if (!record.collectorRunId && !allowNegativeControls) {
    gaps.push({
      kind: "missing-collector-run-id",
      subject: record.subjectId,
      message: "proof evidence must carry the collector run id that executed the command",
    });
  }
  if (
    record.proofLevelObserved &&
    record.proofLevelObserved !== proofLevelId(observedLevelFromEvidence(record))
  ) {
    gaps.push({
      kind: "observed-level-mismatch",
      subject: record.subjectId,
      message: `emitted observed level ${record.proofLevelObserved} does not match calculated ${proofLevelId(observedLevelFromEvidence(record))}`,
    });
  }
  if (!evidenceCommitMatchesCurrent(record, ctx)) {
    gaps.push({
      kind: "stale-evidence",
      subject: record.subjectId,
      message: `evidence commit ${record.commit || "<missing>"} does not match current commit ${ctx.headCommit}`,
    });
  }
  if (record.skipped === true && !record.skipReason) {
    gaps.push({
      kind: "skipped-without-reason",
      subject: record.subjectId,
      message: "skipped proof must carry an explicit skip reason",
    });
  }
  if (record.skipped === true && proofLevelNumber(record.proofLevelClaimed) > 0) {
    gaps.push({
      kind: "skipped-proof-marked-pass",
      subject: record.subjectId,
      message: "skipped proof cannot claim a passing proof level",
    });
  }
  if (record.exitStatus !== 0 && record.skipped !== true) {
    gaps.push({
      kind: "proof-command-failed",
      subject: record.subjectId,
      message: `proof command exited ${record.exitStatus}`,
    });
  }
  if (proofLevelNumber(record.proofLevelClaimed) > observedLevelFromEvidence(record)) {
    gaps.push({
      kind: "proof-claim-overstated",
      subject: record.subjectId,
      message: `claimed ${record.proofLevelClaimed} exceeds observed ${proofLevelId(observedLevelFromEvidence(record))}`,
    });
  }
  for (const gap of environmentConsistencyGaps(record)) gaps.push(gap);
  if (record.inMemoryProviderUsed && record.providerMode !== "semantic-dev") {
    gaps.push({
      kind: "in-memory-provider-mode",
      subject: record.subjectId,
      message: "in-memory provider evidence must be classified as semantic-dev only",
    });
  }
  if (record.realLocalProviderUsed && record.inMemoryProviderUsed) {
    gaps.push({
      kind: "in-memory-labelled-real-provider",
      subject: record.subjectId,
      message: "in-memory proof cannot also claim real-local provider evidence",
    });
  }
  if (record.fakeProviderUsed && proofLevelNumber(record.proofLevelClaimed) >= 4) {
    gaps.push({
      kind: "fake-http-labelled-l4",
      subject: record.subjectId,
      message: "fake HTTP adapter proof cannot claim Substrate Proven strength",
    });
  }
  if (proofLevelNumber(record.proofLevelClaimed) >= 3) {
    for (const gap of behaviourGaps(record)) gaps.push({ ...gap, subject: record.subjectId });
  }
  if (proofLevelNumber(record.proofLevelClaimed) >= 4) {
    for (const gap of substrateGaps(record)) gaps.push({ ...gap, subject: record.subjectId });
  }
  if (proofLevelNumber(record.proofLevelClaimed) >= 4 && record.environmentMode === "dev") {
    gaps.push({
      kind: "dev-proof-claims-l4",
      subject: record.subjectId,
      message: "DEV semantic-dev proof cannot claim L4/L5/L6 strength",
    });
  }
  if (proofLevelNumber(record.proofLevelClaimed) >= 5) {
    for (const gap of resilienceGaps(record)) gaps.push({ ...gap, subject: record.subjectId });
  }
  if (proofLevelNumber(record.proofLevelClaimed) >= 6) {
    for (const gap of foundationGaps(record)) gaps.push({ ...gap, subject: record.subjectId });
  }
  if (observabilitySubject(record) && !observabilityComplete(record)) {
    gaps.push({
      kind: "observability-proof-signal",
      subject: record.subjectId,
      message: "observability proof lacks captured trace/log/metric evidence",
    });
  }
  if (
    !allowNegativeControls &&
    record.subjectIds.some((subject) => subject === "/" || subject.endsWith("/*"))
  ) {
    gaps.push({
      kind: "broad-route-mapping",
      subject: record.subjectId,
      message: "proof evidence subject mapping cannot use broad route prefixes",
    });
  }
}

function evidenceCommitMatchesCurrent(record, ctx) {
  if (!ctx?.headCommit) return true;
  if (record.commit === ctx.headCommit) return true;
  if (!record.commit || record.commit !== ctx.headParentCommit) return false;
  return isEvidenceOnlyAttestationFileSet(ctx.headChangedFilesFromParent || []);
}

const EVIDENCE_ONLY_ATTESTATION_PATHS = [
  "docs/v2-foundation/usf-audit/",
  "docs/v2-foundation/universal-service-foundation-assurance.md",
  "docs/v2-foundation/v2-readiness-final-attestation.md",
];

function isEvidenceOnlyAttestationFileSet(files) {
  return (
    files.length > 0 &&
    files.every((file) =>
      EVIDENCE_ONLY_ATTESTATION_PATHS.some(
        (allowed) => file === allowed || (allowed.endsWith("/") && file.startsWith(allowed))
      )
    )
  );
}

export function observedLevelFromEvidence(record) {
  if (record.skipped === true || record.exitStatus !== 0) return 0;
  const env = record.environmentMode || record.environment || "unknown";
  const hasShape = Boolean(
    record.proofId && record.commandExecuted && record.startedAt && record.endedAt
  );
  const hasExecutable = hasShape && record.exitStatus === 0;
  const hasContract =
    hasShape &&
    record.exitStatus === 0 &&
    record.assertionsObserved === true &&
    record.expectedOutputsAsserted === true;
  const hasBehaviour = behaviourGaps(record).length === 0;
  const hasRealLocal =
    hasBehaviour &&
    env === "test" &&
    record.providerMode === "compose-local" &&
    record.realLocalProviderUsed === true &&
    record.fakeProviderUsed !== true;
  const hasStagingResilience =
    hasBehaviour && (isFullL5ResilienceRecord(record) || isL5aLocalResilienceRecord(record));
  const hasFoundation =
    proofLevelNumber(record.proofLevelClaimed) >= 6 &&
    l6CorrelationComplete(record) &&
    foundationGaps(record).length === 0;
  if (hasFoundation) return 6;
  if (hasStagingResilience) return 5;
  if (hasRealLocal) return 4;
  if (hasBehaviour) return 3;
  if (hasContract) return 2;
  if (hasExecutable) return 1;
  if (hasShape) return 0;
  return 0;
}

function environmentConsistencyGaps(record) {
  const gaps = [];
  const env = record.environmentMode || record.environment || "unknown";
  const model = ENVIRONMENT_PROOF_MODEL[env];
  const claimed = proofLevelNumber(record.proofLevelClaimed);
  const observed = observedLevelFromEvidence(record);
  if (!model) {
    return [
      {
        kind: "unknown-proof-environment",
        subject: record.subjectId,
        message: `proof evidence uses unknown environment ${env}`,
      },
    ];
  }
  const stagingCompleteJourneyClaim =
    env === "staging" && claimed === 6 && l6CorrelationComplete(record);
  const stagingCompleteJourneyObserved =
    env === "staging" && observed === 6 && l6CorrelationComplete(record);
  const localL5aClaim = env === "test" && claimed === 5 && isL5aLocalResilienceRecord(record);
  const localL5aObserved = env === "test" && observed === 5 && isL5aLocalResilienceRecord(record);
  if (claimed > model.maxLevel && !stagingCompleteJourneyClaim && !localL5aClaim) {
    gaps.push({
      kind: "environment-level-forbidden",
      subject: record.subjectId,
      message: `${env.toUpperCase()} proof cannot claim ${proofLevelId(claimed)}`,
    });
  }
  if (observed > model.maxLevel && !stagingCompleteJourneyObserved && !localL5aObserved) {
    gaps.push({
      kind: "environment-observed-level-forbidden",
      subject: record.subjectId,
      message: `${env.toUpperCase()} proof cannot observe ${proofLevelId(observed)}`,
    });
  }
  if (!model.providerModes.includes(record.providerMode)) {
    gaps.push({
      kind: "provider-mode-environment-mismatch",
      subject: record.subjectId,
      message: `provider mode ${record.providerMode} is not valid for ${env}`,
    });
  }
  if (env === "dev") {
    if (record.inMemoryProviderUsed !== true) {
      gaps.push({
        kind: "dev-provider-not-in-memory",
        subject: record.subjectId,
        message: "DEV proof evidence must use an in-memory semantic provider",
      });
    }
    if (record.realLocalProviderUsed || record.externalSandboxProviderUsed) {
      gaps.push({
        kind: "dev-provider-strength-overclaim",
        subject: record.subjectId,
        message: "DEV proof evidence cannot use real-local or external sandbox provider flags",
      });
    }
  }
  if (claimed >= 4 && behaviourGaps(record).length > 0) {
    gaps.push({
      kind: "l4-blocked-by-incomplete-l3",
      subject: record.subjectId,
      message:
        "L4 Substrate Proven classification is blocked until L3 Behaviour Proven is complete",
    });
  }
  if (env === "test" && claimed >= 4) {
    if (record.providerMode !== "compose-local" || record.realLocalProviderUsed !== true) {
      gaps.push({
        kind: "test-l4-provider-mode",
        subject: record.subjectId,
        message: "L4 TEST proof must use compose-local real local substrate evidence",
      });
    }
  }
  if (claimed >= 5 && substrateGaps(record).length > 0) {
    gaps.push({
      kind: "l5-blocked-by-incomplete-l4",
      subject: record.subjectId,
      message:
        "L5 Resilience Proven classification is blocked until L4 Substrate Proven is complete",
    });
  }
  if (claimed >= 6 && resilienceGaps(record).length > 0) {
    gaps.push({
      kind: "l6-blocked-by-incomplete-l5",
      subject: record.subjectId,
      message:
        "L6 Foundation Proven classification is blocked until L5 Resilience Proven is complete",
    });
  }
  if (env === "prod" && claimed > 1) {
    gaps.push({
      kind: "prod-proof-strength-forbidden",
      subject: record.subjectId,
      message: "PROD evidence is readiness-only and cannot create proof strength",
    });
  }
  return gaps;
}

function buildProofLadderComplianceReport(records) {
  const rows = records.map((record) => {
    const gaps = ladderGaps(record);
    return {
      proofId: record.proofId,
      subjectId: record.subjectId,
      environment: record.environmentMode,
      providerMode: record.providerMode,
      proofLevelClaimed: record.proofLevelClaimed,
      proofLevelObserved: proofLevelId(observedLevelFromEvidence(record)),
      compliant: gaps.length === 0,
      gaps,
      evidenceFile: record.evidenceFile,
    };
  });
  const gaps = rows.flatMap((row) =>
    row.gaps.map((gap) => ({ ...gap, proofId: row.proofId, subject: row.subjectId }))
  );
  return {
    artefact: "proof-ladder-compliance-report",
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    status: gaps.length === 0 ? "PASS" : "FAIL",
    ladder: PROOF_LEVELS,
    environmentModel: ENVIRONMENT_PROOF_MODEL,
    gaps,
    records: rows,
  };
}

function ladderGaps(record) {
  const gaps = [];
  const claimed = proofLevelNumber(record.proofLevelClaimed);
  const observed = observedLevelFromEvidence(record);
  if (claimed > observed) {
    gaps.push({
      kind: "proof-claim-overstated",
      message: `claimed ${record.proofLevelClaimed} exceeds observed ${proofLevelId(observed)}`,
    });
  }
  if (claimed >= 2) gaps.push(...contractGaps(record));
  if (claimed >= 3) gaps.push(...behaviourGaps(record));
  if (claimed >= 4) gaps.push(...substrateGaps(record));
  if (claimed >= 5) gaps.push(...resilienceGaps(record));
  if (claimed >= 6) gaps.push(...foundationGaps(record));
  return gaps;
}

function buildEnvironmentProofConsistencyReport(records) {
  const rows = records.map((record) => {
    const gaps = environmentConsistencyGaps(record);
    return {
      proofId: record.proofId,
      subjectId: record.subjectId,
      environment: record.environmentMode,
      providerMode: record.providerMode,
      providerEvidenceClass: providerEvidenceClass(record),
      proofLevelClaimed: record.proofLevelClaimed,
      proofLevelObserved: proofLevelId(observedLevelFromEvidence(record)),
      environmentValid: gaps.length === 0,
      gaps,
      evidenceFile: record.evidenceFile,
    };
  });
  const gaps = rows.flatMap((row) =>
    row.gaps.map((gap) => ({ ...gap, proofId: row.proofId, subject: row.subjectId }))
  );
  return {
    artefact: "environment-proof-consistency-report",
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    status: gaps.length === 0 ? "PASS" : "FAIL",
    environmentModel: ENVIRONMENT_PROOF_MODEL,
    gaps,
    records: rows,
  };
}

function buildProofLadderMigrationReport() {
  return {
    artefact: "proof-ladder-migration-report",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "PASS",
    strategy:
      "L3 Behaviour Proven is the current programme milestone; L4 Substrate Proven work is blocked until behavioural readiness is complete.",
    oldToNewMapping: PROOF_LADDER_MIGRATION,
    newProofLevels: PROOF_LEVELS,
    policy: {
      l3ClosureBeforeL4: true,
      l4RequiresCompleteL3: true,
      l5RequiresCompleteL4: true,
      l6RequiresCompleteL5: true,
      inMemoryParityProgrammeStatus: "complete",
    },
  };
}

function buildBehaviourProofLockingReport(records) {
  const candidates = records.filter((record) => isClassifiedAtLeast(record, 3));
  const proofs = candidates.map((record) => {
    const gaps = behaviourGaps(record);
    const delegatedBehaviourImports = delegatedRuntimeProofImports(record);
    const inconsistencies = behaviourInconsistencies(record, gaps);
    const blockingDeficiencies = [
      ...gaps.map((gap) => gap.kind),
      ...inconsistencies.map((gap) => gap.kind),
    ];
    return {
      proofId: record.proofId,
      subjectId: record.subjectId,
      proofLevelClaimed: record.proofLevelClaimed,
      proofLevelObserved: proofLevelId(observedLevelFromEvidence(record)),
      environmentMode: record.environmentMode,
      providerMode: record.providerMode,
      complete: gaps.length === 0 && inconsistencies.length === 0,
      missingBeforeState: gaps.some((gap) => gap.kind === "missing-before-state"),
      missingAfterState: gaps.some((gap) => gap.kind === "missing-after-state"),
      missingAssertedStateDiff: gaps.some((gap) => gap.kind === "missing-asserted-state-diff"),
      missingSideEffectAssertion: gaps.some((gap) => gap.kind === "missing-side-effect-assertion"),
      missingFailurePathEvidence: gaps.some((gap) => gap.kind === "missing-failure-path-evidence"),
      missingAuditEvidence: gaps.some((gap) => gap.kind === "missing-audit-evidence"),
      missingMetricEvidence: gaps.some((gap) => gap.kind === "missing-metric-evidence"),
      missingTraceEvidence: gaps.some((gap) => gap.kind === "missing-trace-evidence"),
      missingTenantBoundaryEvidence: gaps.some(
        (gap) => gap.kind === "missing-tenant-boundary-evidence"
      ),
      missingSecurityBoundaryEvidence: gaps.some(
        (gap) => gap.kind === "missing-security-boundary-evidence"
      ),
      missingDeterministicReplayEvidence: gaps.some(
        (gap) => gap.kind === "missing-deterministic-replay-evidence"
      ),
      delegatedBehaviourProofImports: delegatedBehaviourImports,
      behaviouralEvidenceInconsistencies: inconsistencies,
      behaviouralEvidenceOverstatingConfidence:
        proofLevelNumber(record.proofLevelClaimed) >= 3 && gaps.length > 0,
      severity: behaviourGapSeverity(record, gaps, inconsistencies),
      remediationEffort: behaviourRemediationEffort(gaps, inconsistencies),
      exactClosureAction: behaviourClosureAction(gaps, inconsistencies),
      blockingDeficiencies,
      evidenceFile: record.evidenceFile,
      sourceFileRefs: record.sourceFileRefs,
    };
  });
  const gaps = proofs
    .filter((proof) => !proof.complete)
    .map((proof) => ({
      kind: "behaviour-proof-incomplete",
      proofId: proof.proofId,
      subject: proof.subjectId,
      severity: proof.severity,
      remediationEffort: proof.remediationEffort,
      blockingDeficiencies: proof.blockingDeficiencies,
      message: `Behaviour proof is incomplete: ${proof.blockingDeficiencies.join(", ")}`,
      exactClosureAction: proof.exactClosureAction,
    }));
  return {
    artefact: "behaviour-proof-locking-report",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: gaps.length === 0 ? "PASS" : "FAIL",
    totalBehaviourCandidates: proofs.length,
    completeBehaviourProofs: proofs.filter((proof) => proof.complete).length,
    incompleteBehaviourProofs: proofs.filter((proof) => !proof.complete).length,
    gaps,
    proofs,
  };
}

export function buildBehaviourProofQualityReport(ctx, records) {
  const candidates = records.filter((record) => isClassifiedAtLeast(record, 3));
  const capabilityLookup = capabilityLookupForRecords(ctx, records);
  const proofRecords = candidates.map((record) =>
    behaviourQualityRecord(record, capabilityLookup.get(record.proofId) || [])
  );
  const blocking = proofRecords.filter((record) => record.blockingIssues.length > 0);
  const weak = proofRecords.filter((record) => record.weakBehaviouralEvidence);
  return {
    artefact: "behaviour-proof-quality-report",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: blocking.length === 0 && weak.length === 0 ? "PASS" : "FAIL",
    scope: "proofs classified as L3 or higher by claimed or observed proof level",
    totalProofsAudited: proofRecords.length,
    validBehaviourProofs: proofRecords.filter((record) => record.validBehaviourProof).length,
    invalidBehaviourProofs: proofRecords.filter((record) => !record.validBehaviourProof).length,
    weakBehaviouralEvidenceProofs: weak.length,
    delegatedBehaviourProofs: proofRecords.filter((record) => record.flags.delegatedProofImports)
      .length,
    wrapperOnlyProofs: proofRecords.filter((record) => record.flags.wrapperOnlyProof).length,
    metadataOnlyProofs: proofRecords.filter((record) => record.flags.metadataOnlyProof).length,
    evidenceInflationProofs: proofRecords.filter((record) => record.flags.evidenceInflation).length,
    blockingIssues: uniq(blocking.flatMap((record) => record.blockingIssues)),
    proofs: proofRecords,
  };
}

function behaviourQualityRecord(record, capabilities) {
  const gaps = behaviourGaps(record);
  const inconsistencies = behaviourInconsistencies(record, gaps);
  const source = sourceEvidence(record);
  const delegatedImports = delegatedRuntimeProofImports(record);
  const strictDefinition = {
    beforeStateCaptured: isMeaningfulObject(record.beforeState),
    afterStateCaptured: isMeaningfulObject(record.afterState),
    stateDiffAsserted: isMeaningfulObject(record.assertedStateDiff),
    sideEffectsAsserted: record.sideEffectsAsserted === true,
    failurePathExercised: record.failurePathExercised === true,
    auditEvidenceAsserted: (record.auditEventIds || []).length > 0,
    metricEvidenceAsserted: (record.metricSamples || []).length > 0,
    traceEvidenceAsserted: (record.traceIds || []).length > 0,
    tenantBoundariesAsserted: record.tenantBoundaryAsserted === true,
    securityBoundariesAsserted: record.securityBoundaryAsserted === true,
    deterministicReplaySupported: record.deterministicReplaySupported === true,
  };
  const sourceAssertions = source.assertionCount > 0 || record.assertionsObserved === true;
  const mappedRuntimeSubjects = [
    ...(record.routeIds || []),
    ...(record.workflowIds || []),
    ...(record.eventIds || []),
    ...(record.storageIds || []),
  ];
  const sourceExecutesBehaviour =
    source.awaitCount > 0 ||
    source.domainOperationCount > 0 ||
    (sourceAssertions &&
      record.exitStatus === 0 &&
      record.skipped !== true &&
      (mappedRuntimeSubjects.length > 0 ||
        (source.wrapperOnly === false && source.sourceFilesChecked.length > 0)));
  const sourceFailureEvidence =
    source.failurePatternCount > 0 || isMeaningfulEvidence(record.failureMode);
  const observableSideEffects =
    (record.auditEventIds || []).length > 0 &&
    (record.metricSamples || []).length > 0 &&
    (record.traceIds || []).length > 0 &&
    (record.logCorrelationIds || []).length > 0;
  const flags = {
    delegatedProofImports: delegatedImports.length > 0,
    wrapperOnlyProof: source.wrapperOnly,
    metadataOnlyProof: !sourceExecutesBehaviour && source.emitEvidenceCount > 0,
    assertionFreeProof: !sourceAssertions,
    weakStateTransitionProof:
      gaps.some((gap) =>
        ["missing-before-state", "missing-after-state", "missing-asserted-state-diff"].includes(
          gap.kind
        )
      ) || !stateTransitionWouldFailOnRegression(record, source),
    syntheticFailurePath:
      record.failurePathExercised === true &&
      !sourceFailureEvidence &&
      !failureStateEvidence(record),
    nonObservableSideEffects: record.sideEffectsAsserted === true && !observableSideEffects,
    evidenceInflation:
      proofLevelNumber(record.proofLevelClaimed) > observedLevelFromEvidence(record) ||
      (proofLevelNumber(record.proofLevelClaimed) >= 3 && gaps.length > 0),
    behaviourClaimsUnsupportedByAssertions:
      proofLevelNumber(record.proofLevelClaimed) >= 3 && !sourceAssertions,
  };
  const wouldFailOnBehaviourRegression =
    sourceAssertions &&
    sourceExecutesBehaviour &&
    stateTransitionWouldFailOnRegression(record, source) &&
    sourceFailureEvidence &&
    observableSideEffects &&
    gaps.length === 0 &&
    inconsistencies.length === 0;
  const blockingIssues = [
    ...gaps.map((gap) => gap.kind),
    ...inconsistencies.map((gap) => gap.kind),
    ...Object.entries(flags)
      .filter(([, value]) => value === true)
      .map(([kind]) => kind),
    ...(wouldFailOnBehaviourRegression ? [] : ["weak-behavioural-evidence"]),
  ];
  const positiveSignals = Object.values(strictDefinition).filter(Boolean).length;
  const qualityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round((positiveSignals / Object.keys(strictDefinition).length) * 70) +
        (sourceAssertions ? 8 : 0) +
        (sourceExecutesBehaviour ? 8 : 0) +
        (sourceFailureEvidence ? 6 : 0) +
        (observableSideEffects ? 5 : 0) +
        (wouldFailOnBehaviourRegression ? 3 : 0) -
        blockingIssues.length * 8
    )
  );
  const confidenceScore = Math.max(
    0,
    Math.min(100, Math.round((qualityScore + (wouldFailOnBehaviourRegression ? 100 : 40)) / 2))
  );
  return {
    proofId: record.proofId,
    capability: capabilities.join("; ") || record.capabilityId || record.subjectId,
    capabilities,
    currentLevel: proofLevelId(
      Math.max(proofLevelNumber(record.proofLevelClaimed), observedLevelFromEvidence(record))
    ),
    proofLevelClaimed: record.proofLevelClaimed,
    proofLevelObserved: proofLevelId(observedLevelFromEvidence(record)),
    qualityScore,
    confidenceScore,
    validBehaviourProof: blockingIssues.length === 0,
    weakBehaviouralEvidence: !wouldFailOnBehaviourRegression,
    wouldFailIfImplementationRegressed: wouldFailOnBehaviourRegression,
    strictDefinition,
    flags,
    sourceEvidence: source,
    delegatedBehaviourProofImports: delegatedImports,
    blockingIssues,
    recommendedRemediation:
      blockingIssues.length === 0
        ? "No action required; preserve this proof as the L3 behavioural contract for future L4 substrate work."
        : behaviourClosureAction(gaps, inconsistencies),
    evidenceFile: record.evidenceFile,
    sourceFileRefs: record.sourceFileRefs,
  };
}

function buildBehaviourProofReadinessReport(
  ctx,
  records,
  behaviourQuality = null,
  l0DiscoveryReadiness = null
) {
  const capabilities = ctx.foundation?.["environment-capability-matrix.json"]?.capabilities || [];
  const bySubject = recordsBySubject(records);
  const qualityByProofId = new Map(
    (behaviourQuality?.proofs || []).map((proof) => [proof.proofId, proof])
  );
  const l0ByCapability = new Map(
    (l0DiscoveryReadiness?.nodes || []).map((node) => [node.capability, node])
  );
  const rows = capabilities.map((capability) => {
    const l0Node = l0ByCapability.get(capability.capability);
    const l0Proven = l0Node ? l0Node.l0DiscoveryProven === true : true;
    const capabilityRecords = uniqRecords([
      ...recordsForRefs(bySubject, capability.dev?.requiredProofs || []),
      ...recordsForRefs(bySubject, capability.test?.requiredProofs || []),
      ...recordsForRefs(bySubject, capability.staging?.requiredProofs || []),
    ]);
    const candidates = capabilityRecords.filter((record) => isClassifiedAtLeast(record, 3));
    const complete = candidates.filter((record) => {
      const quality = qualityByProofId.get(record.proofId);
      return quality ? quality.validBehaviourProof : behaviourGaps(record).length === 0;
    });
    const incomplete = candidates.filter((record) => {
      const quality = qualityByProofId.get(record.proofId);
      return quality ? !quality.validBehaviourProof : behaviourGaps(record).length > 0;
    });
    const blockingDeficiencies = uniq(
      incomplete
        .flatMap((record) => {
          const quality = qualityByProofId.get(record.proofId);
          return quality ? quality.blockingIssues : behaviourGaps(record).map((gap) => gap.kind);
        })
        .concat(l0Proven ? [] : l0Node?.gaps || ["missing-l0-discovery-record"])
    );
    return {
      capability: capability.capability,
      category: capability.category,
      l0DiscoveryProven: l0Proven,
      l3CandidateProofs: candidates.length,
      completeL3Proofs: complete.length,
      incompleteL3Proofs: incomplete.length + (l0Proven ? 0 : 1),
      behaviourProven: l0Proven && candidates.length > 0 && incomplete.length === 0,
      eligibleForSubstrateProvenWork: l0Proven && candidates.length > 0 && incomplete.length === 0,
      blockingDeficiencies,
      closurePercentage:
        candidates.length === 0
          ? 0
          : Math.round((complete.length / candidates.length) * 10000) / 100,
      remainingClosureWork: incomplete.map((record) => ({
        proofId: record.proofId,
        subjectId: record.subjectId,
        missing: behaviourGaps(record).map((gap) => gap.kind),
      })),
      evidenceProofIds: uniq(capabilityRecords.map((record) => record.proofId)),
    };
  });
  const uniqueCandidates = uniqRecords(records.filter((record) => isClassifiedAtLeast(record, 3)));
  const completeUniqueCandidates = uniqueCandidates.filter((record) => {
    const quality = qualityByProofId.get(record.proofId);
    return quality ? quality.validBehaviourProof : behaviourGaps(record).length === 0;
  });
  const incompleteUniqueCandidates = uniqueCandidates.filter((record) => {
    const quality = qualityByProofId.get(record.proofId);
    return quality ? !quality.validBehaviourProof : behaviourGaps(record).length > 0;
  });
  const totalCandidates = uniqueCandidates.length;
  const completeCandidates = completeUniqueCandidates.length;
  const incompleteCandidates = incompleteUniqueCandidates.length;
  const gaps = rows
    .filter((row) => !row.behaviourProven)
    .map((row) => ({
      kind: "capability-behaviour-proof-missing",
      capability: row.capability,
      blockingDeficiencies: row.blockingDeficiencies,
      message:
        row.l3CandidateProofs === 0
          ? `${row.capability} has no L3 Behaviour Proven candidate evidence`
          : `${row.capability} has incomplete L3 Behaviour Proven evidence`,
    }));
  return {
    artefact: "behaviour-proof-readiness-report",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: gaps.length === 0 ? "PASS" : "FAIL",
    milestone: "L3 Behaviour Proven",
    l4ExpansionBlockedUntilStatusPass: true,
    totalL3Candidates: totalCandidates,
    validL3Proofs: completeCandidates,
    invalidL3Proofs: incompleteCandidates,
    completeL3Proofs: completeCandidates,
    incompleteL3Proofs: incompleteCandidates,
    blockingDeficiencies: uniq(gaps.flatMap((gap) => gap.blockingDeficiencies)),
    remediationEffortEstimate: behaviourRemediationEffort(
      uniq(
        incompleteUniqueCandidates.flatMap((record) => behaviourGaps(record).map((gap) => gap.kind))
      ).map((kind) => ({ kind })),
      []
    ),
    closurePercentage:
      totalCandidates === 0 ? 0 : Math.round((completeCandidates / totalCandidates) * 10000) / 100,
    remainingClosureWork: gaps,
    capabilities: rows,
  };
}

function buildBehaviourProofCertificationReport({
  behaviourQuality,
  behaviourLocking,
  behaviourReadiness,
  capabilityReadiness,
  ladderCompliance,
  environmentConsistency,
  claimVsObserved,
}) {
  const delegated = behaviourQuality.proofs.filter((proof) => proof.flags.delegatedProofImports);
  const weak = behaviourQuality.proofs.filter((proof) => proof.weakBehaviouralEvidence);
  const inflated = behaviourQuality.proofs.filter((proof) => proof.flags.evidenceInflation);
  const blockingIssues = [
    ...behaviourQuality.blockingIssues,
    ...(behaviourLocking.status === "PASS" ? [] : ["behaviour-locking-failed"]),
    ...(behaviourReadiness.status === "PASS" ? [] : ["behaviour-readiness-failed"]),
    ...(delegated.length === 0 ? [] : ["delegated-behavioural-proofs"]),
    ...(weak.length === 0 ? [] : ["weak-behavioural-classifications"]),
    ...(inflated.length === 0 ? [] : ["behavioural-evidence-inflation"]),
    ...(claimVsObserved.status === "PASS" ? [] : ["proof-claim-overstated"]),
  ];
  const pass = blockingIssues.length === 0;
  return {
    artefact: "behaviour-proof-certification-report",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: pass ? "PASS" : "FAIL",
    milestone: "L3 Behaviour Proven",
    prerequisiteForFutureL4Work: pass,
    l4ImplementationWorkPermitted: pass,
    requirements: {
      allL3BlockersClosed: pass,
      noDelegatedBehaviouralProofs: delegated.length === 0,
      noWeakBehaviouralClassifications: weak.length === 0,
      noBehaviouralEvidenceInflation: inflated.length === 0,
      behaviourReadinessPassesStrictGate: behaviourReadiness.status === "PASS",
    },
    summary: {
      qualityStatus: behaviourQuality.status,
      readinessStatus: behaviourReadiness.status,
      lockingStatus: behaviourLocking.status,
      capabilityReadinessStatus: capabilityReadiness.status,
      l3ProofsAudited: behaviourQuality.totalProofsAudited,
      validL3Proofs: behaviourQuality.validBehaviourProofs,
      invalidL3Proofs: behaviourQuality.invalidBehaviourProofs,
      delegatedBehaviouralProofs: delegated.length,
      weakBehaviouralClassifications: weak.length,
      behaviouralEvidenceInflationProofs: inflated.length,
      proofClaimMismatches: claimVsObserved.mismatchCount,
      ladderComplianceStatus: ladderCompliance.status,
      environmentConsistencyStatus: environmentConsistency.status,
    },
    blockingIssues: uniq(blockingIssues),
    blockers: behaviourQuality.proofs
      .filter((proof) => proof.blockingIssues.length > 0)
      .map((proof) => ({
        proofId: proof.proofId,
        capability: proof.capability,
        currentLevel: proof.currentLevel,
        blockingIssues: proof.blockingIssues,
        recommendedRemediation: proof.recommendedRemediation,
      })),
    certifiedProofs: behaviourQuality.proofs
      .filter((proof) => proof.validBehaviourProof)
      .map((proof) => ({
        proofId: proof.proofId,
        capability: proof.capability,
        currentLevel: proof.currentLevel,
        qualityScore: proof.qualityScore,
        confidenceScore: proof.confidenceScore,
      })),
  };
}

function buildSubstrateProofRoadmap({ ctx, records, capabilityReadiness, behaviourCertification }) {
  const capabilities = ctx.foundation?.["environment-capability-matrix.json"]?.capabilities || [];
  const capabilityRows = new Map(
    (capabilityReadiness.capabilities || []).map((row) => [row.capability, row])
  );
  const bySubject = recordsBySubject(records);
  const rows = capabilities.map((capability) => {
    const capabilityRecords = uniqRecords([
      ...recordsForRefs(bySubject, capability.dev?.requiredProofs || []),
      ...recordsForRefs(bySubject, capability.test?.requiredProofs || []),
      ...recordsForRefs(bySubject, capability.staging?.requiredProofs || []),
    ]);
    const existingL3Proofs = capabilityRecords
      .filter((record) => isClassifiedAtLeast(record, 3))
      .map((record) => record.proofId);
    const existingL3ProofHarness = uniq(
      capabilityRecords
        .filter((record) => isClassifiedAtLeast(record, 3))
        .map((record) => record.commandExecuted)
    );
    const composeProviders = uniq([
      capability.test?.providerClass === "compose-local" ? capability.test?.provider : null,
      capability.staging?.providerClass === "compose-local" ? capability.staging?.provider : null,
      capability.prod?.providerClass === "compose-local" ? capability.prod?.provider : null,
    ]);
    const requiredComposeSubstrates = substrateServicesForProviders(composeProviders);
    const realImplementations = uniq([
      capability.test?.provider,
      capability.staging?.provider,
      capability.prod?.provider,
      ...(capability.sourceFileRefs || []).filter((ref) =>
        /adapter|repository|provider/i.test(ref)
      ),
    ]);
    return {
      capability: capability.capability,
      category: capability.category,
      l3BehaviourPrerequisiteProofs: existingL3Proofs,
      existingL3ProofHarnessToReuse: existingL3ProofHarness,
      behaviourCertified: behaviourCertification.status === "PASS" && existingL3Proofs.length > 0,
      requiredComposeSubstrates,
      requiredRealImplementations: realImplementations,
      realAdapterOrProviderInvolved: realImplementations,
      substrateDependencies: uniq([
        capability.test?.externalDependencyRisk,
        capability.staging?.externalDependencyRisk,
      ]),
      implementationRisks: uniq([
        capability.test?.securityRisk,
        capability.test?.externalDependencyRisk,
        capability.staging?.secretPolicy,
        capability.staging?.networkPolicy,
      ]),
      likelyRiskAreas: uniq([
        capability.test?.securityRisk,
        capability.test?.externalDependencyRisk,
        capability.staging?.secretPolicy,
        capability.staging?.networkPolicy,
      ]),
      migrationEffort: substrateMigrationEffort(requiredComposeSubstrates, realImplementations),
      l4ProofCommandToCreate: `npm run proof:l4-${slugify(capability.capability)}`,
      expectedStatefulSubstrateEvidence: [
        "compose service readiness captured before proof execution",
        "real adapter/provider invoked against compose-local substrate",
        "before-state and after-state captured from the real substrate",
        "asserted parity diff against the certified L3 behavioural contract",
        "audit, metric, trace, and log correlation evidence captured from real substrate execution",
      ],
      setupTeardownRequirements: [
        requiredComposeSubstrates.length > 0
          ? `start compose substrates: ${requiredComposeSubstrates.join(", ")}`
          : "confirm no additional compose substrate is required for this capability",
        "seed isolated tenant, user, and provider fixture state",
        "run the existing L3 behavioural harness unchanged against real adapters/providers",
        "remove seeded rows, buckets, keys, messages, and provider-side resources after execution",
        "verify cleanup and deterministic replay before recording L4 evidence",
      ],
      substrateProofStrategy:
        existingL3Proofs.length === 0
          ? "Blocked: establish L3 behavioural contract before designing substrate proof."
          : "Reuse the certified L3 behavioural contract unchanged; run the same expectations against compose-local real providers and compare behavioural parity without introducing new behavioural assertions.",
      futureProofLevel: "L4 Substrate Proven",
      l4ImplementationStatus: "not-started",
      l4ImplementationProhibitedUntilCertificationPasses: behaviourCertification.status !== "PASS",
      capabilityReadiness: capabilityRows.get(capability.capability)?.readiness || "UNPROVEN",
    };
  });
  return {
    artefact: "substrate-proof-roadmap",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: behaviourCertification.status === "PASS" ? "PASS" : "BLOCKED",
    prerequisite: "behaviour-proof-certification-report.status == PASS",
    l4ProofsImplementedByThisArtifact: false,
    roadmapScope:
      "Planning only. No L4 proof implementation is introduced before Behaviour Proven certification.",
    capabilityCount: rows.length,
    requiredComposeSubstrates: uniq(rows.flatMap((row) => row.requiredComposeSubstrates)),
    capabilities: rows,
  };
}

function buildL4SubstrateEvidenceReport({
  ctx,
  records,
  l0DiscoveryReadiness,
  capabilityReadiness = null,
}) {
  const capabilities = ctx.foundation?.["environment-capability-matrix.json"]?.capabilities || [];
  const bySubject = recordsBySubject(records);
  const l0ByCapability = new Map(
    (l0DiscoveryReadiness?.nodes || []).map((node) => [node.capability, node])
  );
  const readinessByCapability = new Map(
    (capabilityReadiness?.capabilities || []).map((row) => [row.capability, row])
  );
  const umbrellaL4Proofs = records
    .filter((record) => isL4SubstrateEvidenceCandidate(record))
    .map((record) => {
      const perCapability = normalizePerCapabilityL4Evidence(record.perCapabilityL4Evidence);
      return {
        proofId: record.proofId,
        subjectId: record.subjectId,
        commandExecuted: record.commandExecuted,
        providerMode: record.providerMode,
        subjectIdsCount: (record.subjectIds || []).length,
        perCapabilityEvidenceCount: perCapability.length,
        capabilitiesEnumerated: uniq(perCapability.map((entry) => entry.capability)),
        conclusion:
          perCapability.length > 0
            ? "umbrella-proof-with-per-capability-evidence"
            : "umbrella-proof-does-not-certify-capabilities-without-per-capability-evidence",
      };
    });
  const perCapabilityL4Evidence = capabilities.map((capability) => {
    const l0Node = l0ByCapability.get(capability.capability);
    const l0Pass = l0Node?.l0DiscoveryProven === true;
    const devRecords = recordsForRefs(bySubject, capability.dev?.requiredProofs || []);
    const testRecords = recordsForRefs(bySubject, capability.test?.requiredProofs || []);
    const stagingRecords = recordsForRefs(bySubject, capability.staging?.requiredProofs || []);
    const allCapabilityRecords = uniqRecords([...devRecords, ...testRecords, ...stagingRecords]);
    const highestLevel = l0Pass ? maxObserved(allCapabilityRecords) : 0;
    const behaviourCandidates = allCapabilityRecords.filter((record) =>
      isBehaviourCandidate(record)
    );
    const l1Pass = l0Pass && highestLevel >= 1;
    const l2Pass = l0Pass && highestLevel >= 2;
    const l3Pass =
      l2Pass &&
      behaviourCandidates.length > 0 &&
      behaviourCandidates.every((record) => behaviourGaps(record).length === 0);
    const l4Candidates = allCapabilityRecords.filter((record) =>
      isL4SubstrateEvidenceCandidate(record)
    );
    const evaluations = l4Candidates.map((record) =>
      evaluateCapabilityL4Evidence(capability, record)
    );
    const validEvaluations = evaluations.filter((evaluation) => evaluation.valid);
    const l4Pass = l3Pass && validEvaluations.length > 0;
    const currentReadiness =
      readinessByCapability.get(capability.capability)?.readiness ||
      capabilityReadinessState({
        discovery: l0Pass ? 0 : -1,
        executable: l1Pass ? 1 : 0,
        contract: l2Pass ? 2 : 0,
        behaviour: l3Pass ? 3 : Math.min(highestLevel, 2),
        substrate: l4Pass ? 4 : 0,
        resilience: 0,
        foundation: 0,
      });
    const l4EvidenceProofIds = uniq(validEvaluations.map((evaluation) => evaluation.proofId));
    const candidateProofIds = uniq(evaluations.map((evaluation) => evaluation.proofId));
    const gaps = [];
    if (!l0Pass) gaps.push("l4-blocked-by-missing-l0");
    if (!l1Pass) gaps.push("l4-blocked-by-missing-l1");
    if (!l2Pass) gaps.push("l4-blocked-by-missing-l2");
    if (!l3Pass) gaps.push("l4-blocked-by-missing-l3");
    if (l3Pass && l4Candidates.length === 0) gaps.push("missing-l4-substrate-proof");
    if (l3Pass && l4Candidates.length > 0 && validEvaluations.length === 0) {
      gaps.push("missing-per-capability-l4-evidence");
    }
    for (const evaluation of evaluations) {
      for (const gap of evaluation.gaps) gaps.push(gap);
    }
    const substrateProviderMode = uniq(
      validEvaluations.map((evaluation) => evaluation.providerMode)
    );
    const telemetryEvidence = mergeL4TelemetryEvidence(validEvaluations);
    return {
      capability: capability.capability,
      currentReadiness,
      l0Pass,
      l1Pass,
      l2Pass,
      l3Pass,
      l4Pass,
      l4EvidenceProofIds,
      candidateL4ProofIds: candidateProofIds,
      substrateProviderMode: substrateProviderMode.length > 0 ? substrateProviderMode : ["none"],
      realImplementationPathExecuted:
        validEvaluations.length > 0 &&
        validEvaluations.every((evaluation) => evaluation.realImplementationPathExecuted),
      composeLocalEvidence:
        validEvaluations.length > 0 &&
        validEvaluations.every((evaluation) => evaluation.composeLocalEvidence),
      stateDiffEvidence:
        validEvaluations.length > 0 &&
        validEvaluations.every((evaluation) => evaluation.stateDiffEvidence),
      sideEffectsEvidence:
        validEvaluations.length > 0 &&
        validEvaluations.every((evaluation) => evaluation.sideEffectsEvidence),
      failurePathEvidence:
        validEvaluations.length > 0 &&
        validEvaluations.every((evaluation) => evaluation.failurePathEvidence),
      observabilityEvidence:
        validEvaluations.length > 0 &&
        validEvaluations.every((evaluation) => evaluation.observabilityEvidence),
      telemetryEvidence,
      conclusion: l4Pass
        ? "SUBSTRATE_PROVEN"
        : l3Pass
          ? "BEHAVIOUR_PROVEN_ONLY"
          : "NOT_ELIGIBLE_FOR_L4",
      gaps: uniq(gaps),
    };
  });
  const invalidL4ClaimDetails = perCapabilityL4Evidence.filter(
    (row) => row.currentReadiness === "SUBSTRATE_PROVEN" && row.l4Pass !== true
  );
  const substrateProvenCapabilities = perCapabilityL4Evidence.filter((row) => row.l4Pass).length;
  const behaviourOnlyCapabilities = perCapabilityL4Evidence.filter(
    (row) => row.l3Pass && !row.l4Pass
  ).length;
  const rowGaps = perCapabilityL4Evidence.flatMap((row) =>
    row.gaps.map((gap) => ({
      kind: gap,
      capability: row.capability,
      message: l4CapabilityGapMessage(gap, row.capability),
    }))
  );
  const l4IntegrityGaps = buildL4IntegrityGaps(perCapabilityL4Evidence);
  const gaps = [...rowGaps, ...l4IntegrityGaps];
  return {
    artefact: "l4-substrate-evidence-report",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status:
      capabilities.length > 0 &&
      substrateProvenCapabilities === capabilities.length &&
      invalidL4ClaimDetails.length === 0 &&
      gaps.length === 0 &&
      l4IntegrityGaps.length === 0
        ? "PASS"
        : "FAIL",
    totalCapabilities: capabilities.length,
    substrateProvenCapabilities,
    behaviourOnlyCapabilities,
    invalidL4Claims: invalidL4ClaimDetails.length,
    invalidL4ClaimDetails,
    l4GapCount: gaps.length,
    l4IntegrityGapCount: l4IntegrityGaps.length,
    l4IntegrityGaps,
    umbrellaL4Proofs,
    observedL4ProofCount: umbrellaL4Proofs.length,
    perCapabilityL4Evidence,
    gaps,
  };
}

function buildSubstrateProofReadinessReport({
  l4SubstrateEvidence,
  capabilityReadiness,
  strengthMatrix,
  ladderCompliance,
}) {
  const consistencyGaps = buildReadinessConsistencyGaps({
    capabilityReadiness,
    l4SubstrateEvidence,
    strengthMatrix,
    ladderCompliance,
  });
  return {
    artefact: "substrate-proof-readiness-report",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: l4SubstrateEvidence.status === "PASS" && consistencyGaps.length === 0 ? "PASS" : "FAIL",
    totalCapabilities: l4SubstrateEvidence.totalCapabilities,
    substrateProvenCapabilityCount: l4SubstrateEvidence.substrateProvenCapabilities,
    behaviourOnlyCapabilityCount: l4SubstrateEvidence.behaviourOnlyCapabilities,
    invalidL4Claims: l4SubstrateEvidence.invalidL4Claims,
    observedL4ProofCount: l4SubstrateEvidence.observedL4ProofCount,
    proofStrengthObservedL4Count: strengthMatrix.byObservedLevel?.L4 || 0,
    capabilityReadinessL4Count: capabilityReadiness.ladderLevelDistribution?.L4 || 0,
    consistencyStatus: consistencyGaps.length === 0 ? "PASS" : "FAIL",
    consistencyGaps,
    gaps: l4SubstrateEvidence.gaps,
    capabilities: l4SubstrateEvidence.perCapabilityL4Evidence,
  };
}

function buildResilienceProofRoadmap({
  ctx,
  capabilityReadiness,
  l4SubstrateEvidence,
  substrateRoadmap,
}) {
  const capabilities = ctx.foundation?.["environment-capability-matrix.json"]?.capabilities || [];
  const readinessByCapability = new Map(
    (capabilityReadiness.capabilities || []).map((row) => [row.capability, row])
  );
  const l4ByCapability = new Map(
    (l4SubstrateEvidence.perCapabilityL4Evidence || []).map((row) => [row.capability, row])
  );
  const substrateByCapability = new Map(
    (substrateRoadmap.capabilities || []).map((row) => [row.capability, row])
  );
  const rows = capabilities.map((capability) => {
    const readiness = readinessByCapability.get(capability.capability);
    const l4Evidence = l4ByCapability.get(capability.capability);
    const substrate = substrateByCapability.get(capability.capability);
    const substrates = substrate?.requiredComposeSubstrates || [];
    const riskLevel = resilienceRiskLevel(substrates, substrate?.migrationEffort);
    return {
      capability: capability.capability,
      currentReadiness: readiness?.readiness || "UNPROVEN",
      l4EvidenceProofIds: l4Evidence?.l4EvidenceProofIds || [],
      currentL5Phase: "compose-local resilience planning",
      stagingRequiredToBeginPlanning: false,
      resilienceExecutionPhases: [
        {
          phase: "compose-local resilience",
          purpose:
            "first L5 execution phase using the already-certified local substrate stack and L3/L4 evidence",
          prerequisite: "SUBSTRATE_PROVEN capability with certified L4 evidence",
          certificationRole: "planning-and-local-proof-readiness",
        },
        {
          phase: "staging resilience certification",
          purpose:
            "final L5 certification phase after compose-local resilience evidence is complete",
          prerequisite: "compose-local resilience evidence passed",
          certificationRole: "final-certification",
        },
      ],
      requiredResilienceScenarios: [
        "restart recovery",
        "timeout recovery",
        "retry recovery",
        "concurrency behaviour",
        "degraded-mode behaviour",
        "backup/restore behaviour",
        "failover/recovery behaviour",
      ],
      substrateResilienceScenarios: substrates.map((substrate) =>
        substrateResilienceScenario(substrate)
      ),
      restartScenarios: restartScenariosForSubstrates(substrates),
      timeoutScenarios: timeoutScenariosForSubstrates(substrates),
      retryScenarios: retryScenariosForSubstrates(substrates),
      concurrencyScenarios: concurrencyScenariosForCapability(capability.capability, substrates),
      degradedModeScenarios: degradedModeScenariosForSubstrates(substrates),
      backupRestoreScenarios: backupRestoreScenariosForSubstrates(substrates),
      failoverRecoveryScenarios: failoverRecoveryScenariosForSubstrates(substrates),
      substratesInvolved: substrates,
      proposedL5ProofCommand: `npm run proof:l5-${slugify(capability.capability)}-resilience`,
      expectedEvidence: [
        "reuse the certified L4 proof evidence IDs as substrate baseline",
        "run the first resilience phase against compose-local substrates before staging certification",
        "capture before-state and after-state around each failure injection",
        "assert recovery state diff and no tenant-boundary regression",
        "emit or observe audit, metric, trace, and log evidence for each resilience scenario",
        "prove cleanup and deterministic replay after recovery",
      ],
      riskLevel,
      recommendedImplementationOrder: resilienceImplementationOrder(riskLevel, substrates),
    };
  });
  const gaps = rows.flatMap((row) => {
    const out = [];
    if (row.currentReadiness !== "SUBSTRATE_PROVEN") {
      out.push({
        kind: "l5-roadmap-capability-not-l4",
        capability: row.capability,
        message: `${row.capability} is not SUBSTRATE_PROVEN; L5 planning is blocked`,
      });
    }
    if (row.l4EvidenceProofIds.length === 0) {
      out.push({
        kind: "l5-roadmap-missing-l4-evidence",
        capability: row.capability,
        message: `${row.capability} has no L4 evidence proof IDs to reuse`,
      });
    }
    return out;
  });
  return {
    artefact: "resilience-proof-roadmap",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: gaps.length === 0 && rows.length === capabilities.length ? "PASS" : "FAIL",
    roadmapScope: "Planning only. No L5 proof implementation is introduced by this artefact.",
    l5ProofsImplementedByThisArtifact: false,
    totalCapabilities: rows.length,
    substrateProvenCapabilities: rows.filter((row) => row.currentReadiness === "SUBSTRATE_PROVEN")
      .length,
    substrateScenarioCatalogue: L5_RESILIENCE_SUBSTRATES.map((substrate) =>
      substrateResilienceScenario(substrate)
    ),
    recommendedFirstTarget: recommendedFirstL5Target(rows),
    gaps,
    capabilities: rows,
  };
}

function buildL5ResilienceEvidenceReport({
  ctx,
  records,
  capabilityReadiness,
  l4SubstrateEvidence,
}) {
  const capabilities = ctx.foundation?.["environment-capability-matrix.json"]?.capabilities || [];
  const l4ByCapability = new Map(
    (l4SubstrateEvidence?.perCapabilityL4Evidence || []).map((row) => [row.capability, row])
  );
  const readinessByCapability = new Map(
    (capabilityReadiness?.capabilities || []).map((row) => [row.capability, row])
  );
  const localPilotRecords = records.filter(isL5aLocalResilienceRecord);
  const fullL5Records = records.filter(isFullL5ResilienceRecord);
  const rows = capabilities.map((capability) => {
    const matchingLocalRecords = localPilotRecords.filter((record) =>
      resilienceRecordMatchesCapability(record, capability.capability)
    );
    const matchingFullRecords = fullL5Records.filter((record) =>
      resilienceRecordMatchesCapability(record, capability.capability)
    );
    const l4Row = l4ByCapability.get(capability.capability);
    const readiness = readinessByCapability.get(capability.capability);
    const localResilienceEvidence = matchingLocalRecords.map((record) =>
      l5LocalResilienceEvidenceForCapability(record, capability.capability)
    );
    const l5aLocalResilienceProven = localResilienceEvidence.some((entry) => entry.valid);
    const l5Complete = matchingFullRecords.length > 0;
    const gaps = [];
    if (l4Row?.l4Pass !== true) gaps.push("l4-substrate-not-proven");
    if (!l5aLocalResilienceProven) gaps.push("missing-l5a-compose-local-resilience-evidence");
    if (!l5Complete) gaps.push("missing-l5b-staging-resilience-certification");
    return {
      capability: capability.capability,
      currentReadiness: readiness?.readiness || "UNKNOWN",
      l4Pass: l4Row?.l4Pass === true,
      l5aLocalResilienceProven,
      l5bStagingCertified: l5Complete,
      l5Complete,
      l5aEvidenceProofIds: uniq(matchingLocalRecords.map((record) => record.proofId)),
      l5bEvidenceProofIds: uniq(matchingFullRecords.map((record) => record.proofId)),
      localResilienceEvidence,
      gaps,
      conclusion: l5Complete
        ? "RESILIENCE_PROVEN"
        : l5aLocalResilienceProven
          ? "L5A_LOCAL_RESILIENCE_PROVEN"
          : "SUBSTRATE_PROVEN_AWAITING_L5",
    };
  });
  const pilotRows = rows.filter((row) => row.l5aLocalResilienceProven);
  const l5CompleteRows = rows.filter((row) => row.l5Complete);
  const invalidLocalRecords = localPilotRecords.filter(
    (record) => l5LocalResilienceRecordGaps(record).length > 0
  );
  const remainingL5Work = rows
    .filter((row) => !row.l5Complete)
    .map((row) => ({
      capability: row.capability,
      missing: row.gaps,
      nextPhase: row.l5aLocalResilienceProven
        ? "staging resilience certification"
        : "compose-local resilience proof",
    }));
  const pilotCapability =
    pilotRows.find((row) => row.capability === "Tenant identity (record + FQDN)")?.capability ||
    pilotRows[0]?.capability ||
    null;
  return {
    artefact: "l5-resilience-evidence-report",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: invalidLocalRecords.length === 0 ? "PASS" : "FAIL",
    totalCapabilities: capabilities.length,
    l5CompleteCapabilities: l5CompleteRows.length,
    l5aLocalResilienceProvenCapabilities: pilotRows.length,
    l5bStagingCertifiedCapabilities: l5CompleteRows.length,
    resilienceGapCount: remainingL5Work.length,
    pilotCapability,
    pilotSubstrate: pilotCapability ? "Postgres" : null,
    invalidLocalPilotRecordCount: invalidLocalRecords.length,
    invalidLocalPilotRecords: invalidLocalRecords.map((record) => ({
      proofId: record.proofId,
      subjectId: record.subjectId,
      gaps: l5LocalResilienceRecordGaps(record),
    })),
    remainingL5Work,
    nextRecommendedL5Pilot: nextRecommendedL5Pilot(rows),
    capabilities: rows,
  };
}

function buildResilienceReadinessReport({
  ctx,
  capabilityReadiness,
  l4SubstrateEvidence,
  l5ResilienceEvidence,
  resilienceRoadmap,
}) {
  const totalCapabilities =
    ctx.foundation?.["environment-capability-matrix.json"]?.capabilities?.length || 0;
  const gaps = [];
  if (capabilityReadiness?.status !== "PASS") gaps.push("capability-readiness-not-pass");
  if (l4SubstrateEvidence?.status !== "PASS") gaps.push("l4-substrate-evidence-not-pass");
  if (resilienceRoadmap?.status !== "PASS") gaps.push("resilience-roadmap-not-pass");
  if (l5ResilienceEvidence?.status !== "PASS") gaps.push("l5-resilience-evidence-not-pass");
  if ((l5ResilienceEvidence?.l5CompleteCapabilities || 0) < totalCapabilities) {
    gaps.push("full-l5-resilience-incomplete");
  }
  return {
    artefact: "resilience-readiness-report",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status:
      gaps.filter((gap) => gap !== "full-l5-resilience-incomplete").length === 0 ? "PASS" : "FAIL",
    fullL5Status: gaps.includes("full-l5-resilience-incomplete") ? "INCOMPLETE" : "PASS",
    totalCapabilities,
    l5CompleteCapabilities: l5ResilienceEvidence?.l5CompleteCapabilities || 0,
    l5aLocalResilienceProvenCapabilities:
      l5ResilienceEvidence?.l5aLocalResilienceProvenCapabilities || 0,
    l5bStagingCertifiedCapabilities: l5ResilienceEvidence?.l5bStagingCertifiedCapabilities || 0,
    resilienceGapCount: l5ResilienceEvidence?.resilienceGapCount || totalCapabilities,
    pilotCapability: l5ResilienceEvidence?.pilotCapability || null,
    pilotSubstrate: l5ResilienceEvidence?.pilotSubstrate || null,
    remainingL5Work: l5ResilienceEvidence?.remainingL5Work || [],
    nextRecommendedL5Pilot: l5ResilienceEvidence?.nextRecommendedL5Pilot || null,
    gaps,
  };
}

function buildV2ReadinessSummary({
  behaviourReadiness,
  capabilityReadiness,
  formalGapTaxonomy,
  substrateRoadmap,
  substrateProofReadiness,
  resilienceRoadmap,
  resilienceReadiness,
  l5ResilienceEvidence,
  l4SubstrateEvidence,
  strengthMatrix,
  ladderCompliance,
  l0DiscoveryReadiness,
}) {
  const l3Complete =
    behaviourReadiness.status === "PASS" &&
    behaviourReadiness.closurePercentage === 100 &&
    behaviourReadiness.invalidL3Proofs === 0;
  const formalBlockersClosed =
    formalGapTaxonomy.status === "PASS" && formalGapTaxonomy.totalGapCount === 0;
  const allCapabilitiesEligibleForL4 =
    capabilityReadiness.status === "PASS" &&
    capabilityReadiness.substrateEligibleCapabilityCount === capabilityReadiness.capabilityCount;
  const allCapabilitiesSubstrateProven =
    substrateProofReadiness.status === "PASS" &&
    l4SubstrateEvidence.substrateProvenCapabilities === capabilityReadiness.capabilityCount;
  const consistencyGaps = buildReadinessConsistencyGaps({
    capabilityReadiness,
    l4SubstrateEvidence,
    strengthMatrix,
    ladderCompliance,
  });
  return {
    artefact: "v2-readiness-summary",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status:
      l3Complete &&
      formalBlockersClosed &&
      allCapabilitiesSubstrateProven &&
      resilienceRoadmap.status === "PASS" &&
      formalGapTaxonomy.futureSubstrateExpansionBlocked === false &&
      consistencyGaps.length === 0
        ? "PASS"
        : "FAIL",
    answers: {
      isL3Complete: l3Complete,
      areAllFormalBlockersClosed: formalBlockersClosed,
      areAllCapabilitiesEligibleForL4: allCapabilitiesEligibleForL4,
      areAllCapabilitiesSubstrateProven: allCapabilitiesSubstrateProven,
      isSubstrateExpansionUnblocked: formalGapTaxonomy.futureSubstrateExpansionBlocked === false,
      nextExactMilestone: allCapabilitiesSubstrateProven
        ? "Start L5 Resilience Proven planning only after preserving L4 per-capability substrate evidence."
        : "Implement per-capability L4 Substrate Proven proofs from substrate-proof-roadmap.json, reusing certified L3 behavioural contracts unchanged against compose-local real substrates.",
      whatRemainsBeforeFoundationProven: allCapabilitiesSubstrateProven
        ? [
            "Implement and pass L5 resilience proofs for restart, timeout, retry, concurrency, degraded operation, backup/restore, failover, and operational recovery.",
            "Evaluate L6 Foundation Proven criteria for tenancy, security, observability, operational recovery, governance, ownership, and lifecycle.",
          ]
        : [
            `Implement and pass L4 Substrate Proven proofs for ${l4SubstrateEvidence.behaviourOnlyCapabilities} BEHAVIOUR_PROVEN capabilities still missing per-capability substrate evidence.`,
            "Implement and pass L5 resilience proofs for restart, timeout, retry, concurrency, degraded operation, backup/restore, failover, and operational recovery.",
            "Evaluate L6 Foundation Proven criteria for tenancy, security, observability, operational recovery, governance, ownership, and lifecycle.",
          ],
    },
    evidence: {
      behaviourReadinessStatus: behaviourReadiness.status,
      behaviourClosurePercentage: behaviourReadiness.closurePercentage,
      invalidL3Proofs: behaviourReadiness.invalidL3Proofs,
      totalFormalGapCount: formalGapTaxonomy.totalGapCount,
      futureSubstrateExpansionBlocked: formalGapTaxonomy.futureSubstrateExpansionBlocked,
      capabilityCount: capabilityReadiness.capabilityCount,
      behaviourProvenCapabilityCount: capabilityReadiness.readinessCounts?.BEHAVIOUR_PROVEN || 0,
      substrateProvenCapabilityCount: l4SubstrateEvidence.substrateProvenCapabilities,
      invalidL4Claims: l4SubstrateEvidence.invalidL4Claims,
      observedL4ProofCount: strengthMatrix.byObservedLevel?.L4 || 0,
      substrateRoadmapStatus: substrateRoadmap.status,
      substrateRoadmapCapabilityCount: substrateRoadmap.capabilityCount,
      substrateProofReadinessStatus: substrateProofReadiness.status,
      readinessConsistencyStatus: consistencyGaps.length === 0 ? "PASS" : "FAIL",
      readinessConsistencyGaps: consistencyGaps,
      resilienceRoadmapStatus: resilienceRoadmap.status,
      resilienceRoadmapCapabilityCount: resilienceRoadmap.totalCapabilities,
      recommendedFirstL5Target: resilienceRoadmap.recommendedFirstTarget,
      resilienceReadinessStatus: resilienceReadiness.status,
      fullL5Status: resilienceReadiness.fullL5Status,
      l5CompleteCapabilities: resilienceReadiness.l5CompleteCapabilities,
      l5aLocalResilienceProvenCapabilities:
        resilienceReadiness.l5aLocalResilienceProvenCapabilities,
      l5bStagingCertifiedCapabilities: resilienceReadiness.l5bStagingCertifiedCapabilities,
      l5PilotCapability: resilienceReadiness.pilotCapability,
      l5PilotSubstrate: resilienceReadiness.pilotSubstrate,
      l5ResilienceEvidenceStatus: l5ResilienceEvidence.status,
      l0DiscoveryStatus: l0DiscoveryReadiness.status,
      l0RuntimeNodes: l0DiscoveryReadiness.runtimeNodes,
      l0RuntimeNodesMissingInMemoryImplementation:
        l0DiscoveryReadiness.runtimeNodesMissingInMemoryImplementation,
      l0InvalidExceptions: l0DiscoveryReadiness.invalidExceptions,
    },
  };
}

const L0_EXCEPTION_CLASSIFICATIONS = new Set([
  "non-runtime",
  "static metadata",
  "generated catalogue",
  "pure schema",
  "external-only future integration",
]);

export function buildL0DiscoveryReadinessReport(ctx, records) {
  const capabilities = ctx.foundation?.["environment-capability-matrix.json"]?.capabilities || [];
  const bySubject = recordsBySubject(records);
  const ownership = ownershipByCapability(ctx);
  const nodes = capabilities.map((capability) => {
    const exception = capability.l0Exception || capability.discoveryException || null;
    const exceptionClassification = exception?.classification || null;
    const hasException = Boolean(exception);
    const validException =
      hasException &&
      L0_EXCEPTION_CLASSIFICATIONS.has(exceptionClassification) &&
      isNonEmptyString(exception.rationale) &&
      isNonEmptyString(exception.approvingRule);
    const runtimeNode = !validException;
    const requiredProofs = uniq([
      ...(capability.dev?.requiredProofs || []),
      ...(capability.test?.requiredProofs || []),
      ...(capability.staging?.requiredProofs || []),
    ]);
    const proofRecords = recordsForRefs(bySubject, requiredProofs);
    const owner =
      capability.runtimeOwner ||
      capability.ownerId ||
      capability.owner ||
      ownership.get(capability.capability);
    const hasInMemoryImplementation =
      capability.dev?.providerClass === "in-memory" &&
      isNonEmptyString(capability.dev?.provider) &&
      /in-memory/i.test(capability.dev.provider);
    const hasDependencies = [
      capability.dev?.externalDependencyRisk,
      capability.test?.externalDependencyRisk,
      capability.staging?.externalDependencyRisk,
      capability.prod?.externalDependencyRisk,
    ].some(isNonEmptyString);
    const hasPortProvider =
      isNonEmptyString(capability.dev?.provider) ||
      isNonEmptyString(capability.test?.provider) ||
      isNonEmptyString(capability.staging?.provider) ||
      isNonEmptyString(capability.prod?.provider);
    const proofCommandRegistered = proofRecords.length > 0;
    const gaps = [];
    if (hasException && !validException) gaps.push("invalid-l0-exception");
    if (!owner && runtimeNode) gaps.push("missing-owner");
    if (!isNonEmptyString(capability.category) && runtimeNode) gaps.push("missing-category");
    if (!hasDependencies && runtimeNode) gaps.push("missing-dependencies");
    if (!hasPortProvider && runtimeNode) gaps.push("missing-port-provider");
    if (!hasInMemoryImplementation && !validException) {
      gaps.push("missing-in-memory-implementation");
    }
    if (!proofCommandRegistered && runtimeNode) gaps.push("missing-proof-command");
    return {
      nodeId: stableId("l0-node", capability.capability),
      capability: capability.capability,
      category: capability.category || null,
      runtimeNode,
      ownerDefined: Boolean(owner),
      owner: owner || null,
      dependenciesDefined: hasDependencies,
      intendedPortProviderDefined: hasPortProvider,
      intendedPortProvider:
        capability.dev?.provider ||
        capability.test?.provider ||
        capability.staging?.provider ||
        capability.prod?.provider ||
        null,
      inMemorySemanticDevImplementationExists: hasInMemoryImplementation,
      inMemorySemanticDevProvider: capability.dev?.provider || null,
      proofCommandRegistered,
      proofCommands: uniq(proofRecords.map((record) => record.commandExecuted)),
      exception: hasException
        ? {
            classification: exceptionClassification,
            rationale: exception?.rationale || null,
            approvingRule: exception?.approvingRule || null,
            valid: validException,
          }
        : null,
      l0DiscoveryProven: gaps.length === 0,
      gaps,
    };
  });
  const gaps = nodes.flatMap((node) =>
    node.gaps.map((kind) => ({
      kind,
      subject: node.capability,
      message: l0GapMessage(kind, node.capability),
      blocksLevels: ["L0", "L1", "L2", "L3", "L4", "L5", "L6"],
    }))
  );
  const runtimeNodes = nodes.filter((node) => node.runtimeNode);
  const exceptionNodes = nodes.filter((node) => node.exception);
  return {
    artefact: "l0-discovery-readiness-report",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: gaps.length === 0 ? "PASS" : "FAIL",
    l0Status: gaps.length === 0 ? "PASS" : "FAIL",
    totalNodes: nodes.length,
    runtimeNodes: runtimeNodes.length,
    runtimeNodesWithInMemoryImplementation: runtimeNodes.filter(
      (node) => node.inMemorySemanticDevImplementationExists
    ).length,
    runtimeNodesMissingInMemoryImplementation: runtimeNodes.filter(
      (node) => !node.inMemorySemanticDevImplementationExists
    ).length,
    exceptionNodes: exceptionNodes.length,
    invalidExceptions: exceptionNodes.filter((node) => node.exception?.valid !== true).length,
    gaps,
    nodes,
  };
}

export function buildCapabilityProofReadinessReport(
  ctx,
  records,
  l0DiscoveryReadiness = null,
  l4SubstrateEvidence = null
) {
  const capabilities = ctx.foundation?.["environment-capability-matrix.json"]?.capabilities || [];
  const bySubject = recordsBySubject(records);
  const l0ByCapability = new Map(
    (l0DiscoveryReadiness?.nodes || []).map((node) => [node.capability, node])
  );
  const l4ByCapability = new Map(
    (l4SubstrateEvidence?.perCapabilityL4Evidence || []).map((row) => [row.capability, row])
  );
  const rows = capabilities.map((capability) => {
    const l0Node = l0ByCapability.get(capability.capability);
    const l0Proven = l0Node?.l0DiscoveryProven === true;
    const devRecords = recordsForRefs(bySubject, capability.dev?.requiredProofs || []);
    const testRecords = recordsForRefs(bySubject, capability.test?.requiredProofs || []);
    const stagingRecords = recordsForRefs(bySubject, capability.staging?.requiredProofs || []);
    const allCapabilityRecords = uniqRecords([...devRecords, ...testRecords, ...stagingRecords]);
    const observedHighestLevel = maxObserved(allCapabilityRecords);
    const highestLevel = l0Proven ? observedHighestLevel : 0;
    const behaviourCandidates = allCapabilityRecords.filter((record) =>
      isBehaviourCandidate(record)
    );
    const behaviourComplete =
      l0Proven &&
      highestLevel >= 2 &&
      behaviourCandidates.length > 0 &&
      behaviourCandidates.every((record) => behaviourGaps(record).length === 0);
    const substrateEligible = behaviourComplete;
    const l4Evidence = l4ByCapability.get(capability.capability);
    const substrateProven = behaviourComplete && l4Evidence?.l4Pass === true;
    const resilienceProven =
      substrateProven && allCapabilityRecords.some((record) => isFullL5ResilienceRecord(record));
    const foundationProven =
      resilienceProven &&
      allCapabilityRecords.some((record) => observedLevelFromEvidence(record) >= 6);
    const readiness = capabilityReadinessState({
      discovery: l0Proven ? 0 : -1,
      executable: l0Proven && highestLevel >= 1 ? 1 : 0,
      contract: l0Proven && highestLevel >= 2 ? 2 : 0,
      behaviour: behaviourComplete ? 3 : Math.min(highestLevel, 2),
      substrate: substrateProven ? 4 : 0,
      resilience: resilienceProven ? 5 : 0,
      foundation: foundationProven ? 6 : 0,
    });
    const missingRequiredLevels = capabilityMissingLevels({
      hasDiscovery: l0Proven,
      highestLevel,
      behaviourComplete,
    });
    const futureBlockedLevels = capabilityFutureBlockedLevels({
      behaviourComplete,
      substrateProven,
      resilienceProven,
      foundationProven,
    });
    return {
      capability: capability.capability,
      category: capability.category,
      currentClosureTarget: capabilityCurrentClosureTarget({
        behaviourComplete,
        substrateProven,
        resilienceProven,
        foundationProven,
      }),
      l0DiscoveryProven: l0Proven,
      l0BlockingIssues: l0Node?.gaps || ["missing-l0-discovery-record"],
      highestDiscoveryLevelAchieved: l0Proven ? "L0" : "NONE",
      highestExecutableLevelAchieved: l0Proven && highestLevel >= 1 ? "L1" : "NONE",
      highestContractLevelAchieved: l0Proven && highestLevel >= 2 ? "L2" : "NONE",
      highestBehaviourLevelAchieved: behaviourComplete ? "L3" : "NONE",
      highestSubstrateLevelAchieved: substrateProven ? "L4" : "NONE",
      highestResilienceLevelAchieved: resilienceProven ? "L5" : "NONE",
      highestFoundationLevelAchieved: foundationProven ? "L6" : "NONE",
      readiness,
      l3BehaviourComplete: behaviourComplete,
      eligibleForSubstrateProvenWork: substrateEligible,
      fullServiceVerified: substrateProven,
      fullyProven: foundationProven,
      evidenceProofIds: uniq(allCapabilityRecords.map((record) => record.proofId)),
      missingRequiredLevels,
      missingRequiredBands: missingRequiredLevels,
      advancementBlockers: capabilityAdvancementBlockers({
        l0Proven,
        highestLevel,
        behaviourComplete,
        substrateProven,
        resilienceProven,
        foundationProven,
      }),
      futureBlockedLevels,
    };
  });
  const gaps = rows.flatMap(capabilityReadinessGaps);
  return {
    artefact: "capability-proof-readiness-report",
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    status: rows.length === capabilities.length && gaps.length === 0 ? "PASS" : "FAIL",
    modelConsistencyStatus: rows.length === capabilities.length ? "PASS" : "FAIL",
    migrationReadinessStatus: gaps.length === 0 ? "PASS" : "FAIL",
    capabilityCount: rows.length,
    fullyProvenCapabilityCount: rows.filter((row) => row.fullyProven).length,
    fullServiceVerifiedCapabilityCount: rows.filter((row) => row.fullServiceVerified).length,
    behaviourProvenCapabilityCount: rows.filter((row) => row.l3BehaviourComplete).length,
    substrateEligibleCapabilityCount: rows.filter((row) => row.eligibleForSubstrateProvenWork)
      .length,
    readinessCounts: rows.reduce((acc, row) => {
      acc[row.readiness] = (acc[row.readiness] || 0) + 1;
      return acc;
    }, {}),
    ladderLevelDistribution: {
      L0: rows.filter((row) => row.highestDiscoveryLevelAchieved === "L0").length,
      L1: rows.filter((row) => row.highestExecutableLevelAchieved === "L1").length,
      L2: rows.filter((row) => row.highestContractLevelAchieved === "L2").length,
      L3: rows.filter((row) => row.highestBehaviourLevelAchieved === "L3").length,
      L4: rows.filter((row) => row.highestSubstrateLevelAchieved === "L4").length,
      L5: rows.filter((row) => row.highestResilienceLevelAchieved === "L5").length,
      L6: rows.filter((row) => row.highestFoundationLevelAchieved === "L6").length,
    },
    gaps,
    capabilities: rows,
  };
}

function buildStrengthMatrix(records) {
  const byObserved = Object.fromEntries(PROOF_LEVELS.map((level) => [level.id, 0]));
  const byClass = {};
  let overclaimCount = 0;
  const rows = records.map((record) => {
    const observed = proofLevelId(observedLevelFromEvidence(record));
    const evidenceClass = providerEvidenceClass(record);
    if (proofLevelNumber(record.proofLevelClaimed) > proofLevelNumber(observed)) overclaimCount++;
    byObserved[observed] += 1;
    byClass[evidenceClass] = (byClass[evidenceClass] || 0) + 1;
    return {
      proofId: record.proofId,
      subjectId: record.subjectId,
      subjectType: record.subjectType,
      proofLevelClaimed: record.proofLevelClaimed,
      proofLevelObserved: observed,
      providerEvidenceClass: evidenceClass,
      perCapabilityL4EvidenceCount: normalizePerCapabilityL4Evidence(record.perCapabilityL4Evidence)
        .length,
      l4CapabilityEvidenceMode:
        observed === "L4" &&
        normalizePerCapabilityL4Evidence(record.perCapabilityL4Evidence).length === 0
          ? "umbrella-or-record-level-only"
          : observed === "L4"
            ? "per-capability-evidence-present"
            : "not-l4",
      evidenceFile: record.evidenceFile,
    };
  });
  return {
    artefact: "proof-strength-matrix",
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    status: overclaimCount === 0 ? "PASS" : "FAIL",
    levels: PROOF_LEVELS,
    overclaimCount,
    observedL4ProofCount: byObserved.L4,
    localRealProviderProofCount: byClass["local-real-provider-proof"] || 0,
    byObservedLevel: byObserved,
    byProviderEvidenceClass: byClass,
    records: rows,
  };
}

function buildClaimVsObservedReport(records) {
  const mismatches = records
    .filter(
      (record) => proofLevelNumber(record.proofLevelClaimed) > observedLevelFromEvidence(record)
    )
    .map((record) => ({
      proofId: record.proofId,
      subjectId: record.subjectId,
      proofLevelClaimed: record.proofLevelClaimed,
      proofLevelObserved: proofLevelId(observedLevelFromEvidence(record)),
      providerEvidenceClass: providerEvidenceClass(record),
      evidenceFile: record.evidenceFile,
      sourceFileRefs: record.sourceFileRefs,
    }));
  return {
    artefact: "proof-claim-vs-observed-report",
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    status: mismatches.length === 0 ? "PASS" : "FAIL",
    mismatchCount: mismatches.length,
    mismatches,
  };
}

function buildInMemoryProviderParityReport(ctx, records) {
  const aliases =
    ctx.foundation?.["environment-capability-matrix.json"]?.runtimeProviderAliases || [];
  const inMemoryAliases = aliases.filter((alias) =>
    String(alias.provider).startsWith("in-memory-")
  );
  const parityRecords = records.filter((record) =>
    record.subjectIds.some((subject) => subject.includes("in-memory-vs-real-parity-proof"))
  );
  const providers = inMemoryAliases.map((alias) => {
    const correspondingRealProvider = alias.realProvider || realProviderFor(alias.provider);
    const nonRuntimeStaticProvider = String(correspondingRealProvider).startsWith("not-runtime-");
    const semanticProofs = records.filter(
      (record) =>
        record.inMemoryProviderUsed === true &&
        (record.providerId === alias.provider ||
          record.subjectIds.includes(alias.provider) ||
          record.subjectIds.includes(`provider:${alias.provider}`) ||
          record.subjectIds.includes(alias.proof))
    );
    const parityProofs = parityRecords.filter(
      (record) =>
        record.providerId === alias.provider ||
        record.subjectIds.includes(alias.provider) ||
        record.subjectIds.includes(`provider:${alias.provider}`) ||
        record.subjectIds.includes(alias.proof)
    );
    const nonRuntimeStaticProof =
      nonRuntimeStaticProvider &&
      semanticProofs.some(
        (record) =>
          observedLevelFromEvidence(record) >= 3 &&
          record.providerMode === "semantic-dev" &&
          record.inMemoryProviderUsed === true &&
          record.realLocalProviderUsed !== true &&
          record.externalSandboxProviderUsed !== true
      );
    return {
      provider: alias.provider,
      adapterFile: alias.adapterFile,
      proof: alias.proof,
      correspondingRealProvider,
      nonRuntimeStaticProvider,
      samePortInterface: parityProofs.length > 0 || nonRuntimeStaticProof,
      sameSemanticOutcomes: semanticProofs.some((record) => observedLevelFromEvidence(record) >= 3),
      sameFailureSemantics: semanticProofs.some((record) => record.failurePathExercised === true),
      sameEventAuditObservabilityContract: semanticProofs.some((record) =>
        observabilityComplete(record)
      ),
      semanticDevProofMode:
        semanticProofs.length > 0 &&
        semanticProofs.every((record) => record.providerMode === "semantic-dev")
          ? "in-memory-provider-proof"
          : "missing",
      realProviderParityProofMode:
        parityProofs.length > 0
          ? "port-contract-parity-proof"
          : nonRuntimeStaticProof
            ? "non-runtime-static-proof"
            : "missing",
    };
  });
  const gaps = providers.filter(
    (provider) =>
      provider.correspondingRealProvider === "unknown" ||
      !provider.samePortInterface ||
      !provider.sameSemanticOutcomes ||
      !provider.sameFailureSemantics ||
      !provider.sameEventAuditObservabilityContract ||
      provider.semanticDevProofMode === "missing"
  );
  return {
    artefact: "in-memory-provider-parity-report",
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    status: gaps.length === 0 ? "PASS" : "FAIL",
    providers,
    gaps,
  };
}

export function buildWeakProofBacklog(
  requiredProofs,
  evidence,
  claimVsObserved,
  capabilityReadiness
) {
  const missing = evidence.gaps.filter((gap) =>
    ["missing-evidence", "stale-evidence", "proof-claim-overstated"].includes(gap.kind)
  );
  const capabilityProofGaps = capabilityReadiness.gaps.map((gap) => ({
    capability: gap.capability,
    kind: gap.kind,
    readiness: gap.readiness,
    missingBand: gap.missingBand,
    message: gap.message,
  }));
  const weak = evidence.records
    .filter(
      (record) => observedLevelFromEvidence(record) < proofLevelNumber(record.proofLevelClaimed)
    )
    .map((record) => ({
      proofId: record.proofId,
      subject: record.subjectId,
      claimed: record.proofLevelClaimed,
      observed: proofLevelId(observedLevelFromEvidence(record)),
      evidenceFile: record.evidenceFile,
    }));
  return {
    artefact: "weak-proof-backlog",
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    status:
      missing.length === 0 &&
      claimVsObserved.mismatchCount === 0 &&
      capabilityProofGaps.length === 0
        ? "PASS"
        : "FAIL",
    requiredProofCount: requiredProofs.length,
    missingOrStaleCount: missing.length,
    overclaimCount: claimVsObserved.mismatchCount,
    capabilityProofGapCount: capabilityProofGaps.length,
    missingOrStale: missing,
    capabilityProofGaps,
    weak,
  };
}

export function buildRouteProofSubjectMap(audit) {
  const routes = (audit.inventory.routes || []).map((route) => {
    const proofRefs =
      route.proofRef === "unknown"
        ? []
        : String(route.proofRef)
            .split(/[;,]/)
            .map((ref) => ref.trim())
            .filter(Boolean);
    return {
      routeId: route.routeId,
      method: route.method,
      path: route.path,
      capability: route.capability,
      proofRefs,
      mappingSource: proofRefs.length > 0 ? "explicit-subject-map" : "missing",
      broadPrefixMatchAllowed: false,
      fuzzyRouteMatchingUsed: false,
      mutationBeforeAfterRequired: route.isMutation,
      sourceFileRefs: route.sourceFileRefs || [],
    };
  });
  const gaps = routes.filter(
    (route) =>
      route.proofRefs.length === 0 ||
      route.proofRefs.some((ref) => ref === "/" || ref.endsWith("/*"))
  );
  return {
    artefact: "route-proof-subject-map",
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    status: gaps.length === 0 ? "PASS" : "FAIL",
    routes,
    gaps,
  };
}

function buildNegativeControlReport(ctx) {
  const base = validFixtureRecord(ctx);
  const controls = [
    {
      id: "fake-http-labelled-l4",
      record: { ...base, proofId: "negative:fake-http-labelled-l4", fakeProviderUsed: true },
      expectedKinds: ["fake-http-labelled-l4", "proof-claim-overstated"],
    },
    {
      id: "in-memory-labelled-real-provider",
      record: {
        ...base,
        proofId: "negative:in-memory-labelled-real-provider",
        inMemoryProviderUsed: true,
        realLocalProviderUsed: true,
        providerMode: "compose-local",
      },
      expectedKinds: ["in-memory-provider-mode", "in-memory-labelled-real-provider"],
    },
    {
      id: "in-memory-labelled-l4",
      record: {
        ...base,
        proofId: "negative:in-memory-labelled-l4",
        environmentMode: "dev",
        environment: "dev",
        providerMode: "semantic-dev",
        inMemoryProviderUsed: true,
        realLocalProviderUsed: false,
        proofLevelClaimed: "L4",
      },
      expectedKinds: [
        "environment-level-forbidden",
        "dev-proof-claims-l4",
        "missing-real-local-substrate",
        "proof-claim-overstated",
      ],
    },
    {
      id: "missing-audit-evidence",
      record: {
        ...base,
        proofId: "negative:missing-audit-evidence",
        proofLevelClaimed: "L6",
        auditEventIds: [],
      },
      expectedKinds: ["missing-audit-evidence"],
    },
    {
      id: "missing-trace-evidence",
      record: {
        ...base,
        proofId: "negative:missing-trace-evidence",
        proofLevelClaimed: "L6",
        traceIds: [],
      },
      expectedKinds: ["missing-trace-evidence"],
    },
    {
      id: "missing-metric-evidence",
      record: {
        ...base,
        proofId: "negative:missing-metric-evidence",
        proofLevelClaimed: "L6",
        metricSamples: [],
        metricEvidence: [],
      },
      expectedKinds: ["missing-metric-evidence"],
    },
    {
      id: "missing-workflow-correlation",
      record: {
        ...base,
        proofId: "negative:missing-workflow-correlation",
        proofLevelClaimed: "L6",
        workflowIds: [],
      },
      expectedKinds: ["proof-claim-overstated"],
    },
    {
      id: "missing-event-correlation",
      record: {
        ...base,
        proofId: "negative:missing-event-correlation",
        proofLevelClaimed: "L6",
        eventIds: [],
      },
      expectedKinds: ["proof-claim-overstated"],
    },
    {
      id: "missing-before-after-state",
      record: { ...base, proofId: "negative:missing-before-after-state", beforeState: {} },
      expectedKinds: ["missing-before-state", "proof-claim-overstated"],
    },
    {
      id: "missing-before-state",
      record: { ...base, proofId: "negative:missing-before-state", beforeState: {} },
      expectedKinds: ["missing-before-state"],
    },
    {
      id: "missing-after-state",
      record: { ...base, proofId: "negative:missing-after-state", afterState: {} },
      expectedKinds: ["missing-after-state"],
    },
    {
      id: "missing-failure-path",
      record: {
        ...base,
        proofId: "negative:missing-failure-path",
        failurePathExercised: false,
        failureMode: "not-exercised",
      },
      expectedKinds: ["missing-failure-path-evidence", "proof-claim-overstated"],
    },
    {
      id: "stale-evidence",
      record: { ...base, proofId: "negative:stale-evidence", commit: "0000000" },
      expectedKinds: ["stale-evidence"],
    },
    {
      id: "overclaimed-proof-level",
      record: {
        ...base,
        proofId: "negative:overclaimed-proof-level",
        proofLevelClaimed: "L6",
        routeIds: [],
      },
      expectedKinds: ["proof-claim-overstated", "l6-blocked-by-incomplete-l5"],
    },
    {
      id: "broad-route-mapping",
      record: {
        ...base,
        proofId: "negative:broad-route-mapping",
        subjectIds: ["/"],
        subjectId: "/",
      },
      expectedKinds: ["broad-route-mapping"],
    },
    {
      id: "skipped-proof-marked-pass",
      record: {
        ...base,
        proofId: "negative:skipped-proof-marked-pass",
        skipped: true,
        skipReason: "",
      },
      expectedKinds: [
        "skipped-without-reason",
        "skipped-proof-marked-pass",
        "proof-claim-overstated",
      ],
    },
    {
      id: "deleted-evidence",
      records: [],
      requiredProofs: [
        {
          file: "negative/deleted-evidence-runtime-proof.ts",
          subjectIds: ["negative/deleted-evidence-runtime-proof.ts"],
          commandExecuted: "node negative/deleted-evidence-runtime-proof.ts",
        },
      ],
      expectedKinds: ["missing-evidence"],
    },
  ];
  const results = controls.map((control) => {
    const records =
      control.records ||
      (control.record ? [normalizeEvidenceRecord(signRecord(control.record))] : []);
    const { gaps } = validateEvidenceSet({
      ctx,
      records,
      requiredProofs: control.requiredProofs || [],
      routeSubjectMap: { routes: [] },
      allowNegativeControls: false,
    });
    const kinds = [...new Set(gaps.map((gap) => gap.kind))].sort();
    const passed = control.expectedKinds.every((kind) => kinds.includes(kind));
    return { id: control.id, expectedKinds: control.expectedKinds, observedKinds: kinds, passed };
  });
  const failed = results.filter((result) => !result.passed);
  return {
    artefact: "proof-negative-control-report",
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    status: failed.length === 0 ? "PASS" : "FAIL",
    controls: results,
    failed,
  };
}

export function buildFormalProofGapTaxonomyReport({
  evidence,
  claimVsObserved,
  ladderCompliance,
  environmentConsistency,
  behaviourLocking,
  behaviourReadiness,
  capabilityReadiness,
  inMemoryParity,
  routeSubjectMap,
  l0DiscoveryReadiness = { gaps: [] },
  negativeControls,
}) {
  const gaps = buildFormalProofReadinessGaps({
    evidence,
    claimVsObserved,
    ladderCompliance,
    environmentConsistency,
    behaviourLocking,
    behaviourReadiness,
    capabilityReadiness,
    inMemoryParity,
    routeSubjectMap,
    l0DiscoveryReadiness,
    negativeControls,
  });
  const gapsByKind = countBy(gaps, (gap) => gap.kind);
  const rows = gaps.map((gap) => {
    const classification = formalGapClassification(gap.kind);
    return {
      kind: gap.kind,
      subject: gap.subject,
      message: gap.message,
      closureTrack: classification.closureTrack,
      proofLevelBand: classification.proofLevelBand,
      severity: classification.severity,
      remediationEffort: classification.remediationEffort,
      exactClosureAction: classification.exactClosureAction,
      blocksCurrentL3Milestone: classification.blocksCurrentL3Milestone,
      blocksFutureSubstrateExpansion: classification.blocksFutureSubstrateExpansion,
    };
  });
  const byClosureTrack = Object.values(
    rows.reduce((acc, row) => {
      if (!acc[row.closureTrack]) {
        acc[row.closureTrack] = {
          closureTrack: row.closureTrack,
          gapCount: 0,
          blocksCurrentL3Milestone: false,
          blocksFutureSubstrateExpansion: false,
          proofLevelBands: [],
          exactClosureActions: [],
        };
      }
      acc[row.closureTrack].gapCount += 1;
      acc[row.closureTrack].blocksCurrentL3Milestone ||= row.blocksCurrentL3Milestone;
      acc[row.closureTrack].blocksFutureSubstrateExpansion ||= row.blocksFutureSubstrateExpansion;
      acc[row.closureTrack].proofLevelBands = uniq([
        ...acc[row.closureTrack].proofLevelBands,
        row.proofLevelBand,
      ]);
      acc[row.closureTrack].exactClosureActions = uniq([
        ...acc[row.closureTrack].exactClosureActions,
        row.exactClosureAction,
      ]);
      return acc;
    }, {})
  ).sort((a, b) => a.closureTrack.localeCompare(b.closureTrack));
  const currentL3MilestoneBlocked = rows.some((row) => row.blocksCurrentL3Milestone);
  const futureSubstrateExpansionBlocked = rows.some((row) => row.blocksFutureSubstrateExpansion);
  return {
    artefact: "formal-proof-gap-taxonomy-report",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: gaps.length === 0 ? "PASS" : "FAIL",
    activeMilestone: "L3 Behaviour Proven",
    totalGapCount: gaps.length,
    currentL3MilestoneBlocked,
    futureSubstrateExpansionBlocked,
    behaviourReadinessStatus: behaviourReadiness.status,
    behaviourClosurePercentage: behaviourReadiness.closurePercentage,
    inMemoryParityStatus: inMemoryParity.status,
    gapsByKind,
    byClosureTrack,
    rows,
  };
}

function buildFormalProofReadinessReport({
  evidence,
  claimVsObserved,
  ladderCompliance,
  environmentConsistency,
  behaviourLocking,
  behaviourReadiness,
  capabilityReadiness,
  inMemoryParity,
  routeSubjectMap,
  l0DiscoveryReadiness = {
    status: "PASS",
    gaps: [],
    runtimeNodesMissingInMemoryImplementation: 0,
    invalidExceptions: 0,
  },
  weakProofBacklog,
  negativeControls,
  formalGapTaxonomy,
}) {
  const gaps = buildFormalProofReadinessGaps({
    evidence,
    claimVsObserved,
    ladderCompliance,
    environmentConsistency,
    behaviourLocking,
    behaviourReadiness,
    capabilityReadiness,
    inMemoryParity,
    routeSubjectMap,
    l0DiscoveryReadiness,
    negativeControls,
  });
  return {
    artefact: "v2-formal-proof-readiness-report",
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    status: gaps.length === 0 ? "PASS" : "FAIL",
    summary: {
      evidenceRecords: evidence.recordCount,
      requiredProofs: evidence.requiredProofCount,
      missingEvidence: evidence.missingEvidence.length,
      staleEvidence: evidence.staleEvidence.length,
      claimMismatches: claimVsObserved.mismatchCount,
      inMemoryProviderParityGaps: inMemoryParity.gaps.length,
      l0DiscoveryStatus: l0DiscoveryReadiness.status,
      l0DiscoveryGaps: l0DiscoveryReadiness.gaps.length,
      l0RuntimeNodesMissingInMemoryImplementation:
        l0DiscoveryReadiness.runtimeNodesMissingInMemoryImplementation,
      l0InvalidExceptions: l0DiscoveryReadiness.invalidExceptions,
      routeProofSubjectGaps: routeSubjectMap.gaps.length,
      proofLadderComplianceGaps: ladderCompliance.gaps.length,
      environmentProofConsistencyGaps: environmentConsistency.gaps.length,
      behaviourProofLockingGaps: behaviourLocking.gaps.length,
      behaviourReadinessStatus: behaviourReadiness.status,
      behaviourReadinessGaps: behaviourReadiness.remainingClosureWork.length,
      behaviourClosurePercentage: behaviourReadiness.closurePercentage,
      capabilityReadinessComputed: capabilityReadiness.capabilityCount,
      capabilityReadinessStatus: capabilityReadiness.status,
      capabilityReadinessGaps: capabilityReadiness.gaps.length,
      fullyProvenCapabilities: capabilityReadiness.fullyProvenCapabilityCount,
      fullServiceVerifiedCapabilities: capabilityReadiness.fullServiceVerifiedCapabilityCount,
      weakProofBacklogStatus: weakProofBacklog.status,
      negativeControls: negativeControls.status,
      formalGapTaxonomyStatus: formalGapTaxonomy.status,
      currentL3MilestoneBlocked: formalGapTaxonomy.currentL3MilestoneBlocked,
      futureSubstrateExpansionBlocked: formalGapTaxonomy.futureSubstrateExpansionBlocked,
      remainingFormalGapTracks: formalGapTaxonomy.byClosureTrack.map((track) => ({
        closureTrack: track.closureTrack,
        gapCount: track.gapCount,
      })),
    },
    gaps,
  };
}

function buildFormalProofReadinessGaps({
  evidence,
  claimVsObserved,
  ladderCompliance,
  environmentConsistency,
  behaviourLocking,
  behaviourReadiness,
  capabilityReadiness,
  inMemoryParity,
  routeSubjectMap,
  l0DiscoveryReadiness = { gaps: [] },
  negativeControls,
}) {
  return [
    ...l0DiscoveryReadiness.gaps.map((gap) => ({
      kind: gap.kind,
      subject: gap.subject,
      message: gap.message,
    })),
    ...evidence.gaps,
    ...claimVsObserved.mismatches.map((mismatch) => ({
      kind: "proof-claim-overstated",
      subject: mismatch.subjectId,
      message: `claimed ${mismatch.proofLevelClaimed} exceeds observed ${mismatch.proofLevelObserved}`,
    })),
    ...ladderCompliance.gaps.map((gap) => ({
      kind: gap.kind,
      subject: gap.subject,
      message: gap.message,
    })),
    ...environmentConsistency.gaps.map((gap) => ({
      kind: gap.kind,
      subject: gap.subject,
      message: gap.message,
    })),
    ...behaviourLocking.gaps.map((gap) => ({
      kind: gap.kind,
      subject: gap.subject,
      message: gap.message,
    })),
    ...behaviourReadiness.remainingClosureWork.map((gap) => ({
      kind: gap.kind,
      subject: gap.capability,
      message: gap.message,
    })),
    ...inMemoryParity.gaps.map((gap) => ({
      kind: "in-memory-provider-parity",
      subject: gap.provider,
      message: "in-memory provider lacks complete emitted real-provider parity evidence",
    })),
    ...routeSubjectMap.gaps.map((gap) => ({
      kind: "route-proof-subject-map",
      subject: `${gap.method} ${gap.path}`,
      message: "route proof subject mapping is missing, broad, or fuzzy",
    })),
    ...capabilityReadiness.gaps.map((gap) => ({
      kind: gap.kind,
      subject: gap.capability,
      message: gap.message,
    })),
    ...negativeControls.failed.map((gap) => ({
      kind: "negative-control-not-caught",
      subject: gap.id,
      message: "proof evidence validator did not catch the deliberate failing fixture",
    })),
  ];
}

function formalGapClassification(kind) {
  const classifications = {
    "missing-in-memory-implementation": {
      closureTrack: "discovery-l0",
      proofLevelBand: "L0 Discovery Proven",
      severity: "critical",
      remediationEffort: "medium",
      exactClosureAction:
        "Add an in-memory semantic-dev implementation or declare a valid documented L0 exception.",
      blocksCurrentL3Milestone: true,
      blocksFutureSubstrateExpansion: true,
    },
    "missing-owner": {
      closureTrack: "discovery-l0",
      proofLevelBand: "L0 Discovery Proven",
      severity: "critical",
      remediationEffort: "small",
      exactClosureAction: "Define the runtime owner for the capability/provider node.",
      blocksCurrentL3Milestone: true,
      blocksFutureSubstrateExpansion: true,
    },
    "missing-category": {
      closureTrack: "discovery-l0",
      proofLevelBand: "L0 Discovery Proven",
      severity: "critical",
      remediationEffort: "small",
      exactClosureAction: "Define the capability/provider category.",
      blocksCurrentL3Milestone: true,
      blocksFutureSubstrateExpansion: true,
    },
    "missing-dependencies": {
      closureTrack: "discovery-l0",
      proofLevelBand: "L0 Discovery Proven",
      severity: "critical",
      remediationEffort: "small",
      exactClosureAction: "Define runtime dependency expectations for the node.",
      blocksCurrentL3Milestone: true,
      blocksFutureSubstrateExpansion: true,
    },
    "missing-port-provider": {
      closureTrack: "discovery-l0",
      proofLevelBand: "L0 Discovery Proven",
      severity: "critical",
      remediationEffort: "small",
      exactClosureAction: "Define the intended port/provider for the node.",
      blocksCurrentL3Milestone: true,
      blocksFutureSubstrateExpansion: true,
    },
    "missing-proof-command": {
      closureTrack: "discovery-l0",
      proofLevelBand: "L0 Discovery Proven",
      severity: "critical",
      remediationEffort: "small",
      exactClosureAction: "Register a discoverable proof command for the node.",
      blocksCurrentL3Milestone: true,
      blocksFutureSubstrateExpansion: true,
    },
    "invalid-l0-exception": {
      closureTrack: "discovery-l0",
      proofLevelBand: "L0 Discovery Proven",
      severity: "critical",
      remediationEffort: "small",
      exactClosureAction:
        "Replace the exception with a valid classification, rationale, and approving rule.",
      blocksCurrentL3Milestone: true,
      blocksFutureSubstrateExpansion: true,
    },
    "proof-command-failed": {
      closureTrack: "execution",
      proofLevelBand: "L1 Executable Proven",
      severity: "critical",
      remediationEffort: "medium",
      exactClosureAction:
        "Make the proof command execute successfully or reclassify it as an explicit skipped/future proof with non-passing strength.",
      blocksCurrentL3Milestone: false,
      blocksFutureSubstrateExpansion: true,
    },
    "observability-proof-signal": {
      closureTrack: "observability",
      proofLevelBand: "L3 Behaviour Proven",
      severity: "high",
      remediationEffort: "medium",
      exactClosureAction:
        "Emit correlated trace, metric, and log evidence from the proof process for the observability subject.",
      blocksCurrentL3Milestone: false,
      blocksFutureSubstrateExpansion: true,
    },
    "route-proof-evidence-missing": {
      closureTrack: "route-evidence",
      proofLevelBand: "L1 Executable Proven",
      severity: "high",
      remediationEffort: "medium",
      exactClosureAction:
        "Emit runtime evidence whose explicit subjectIds include the inventoried route proof reference.",
      blocksCurrentL3Milestone: false,
      blocksFutureSubstrateExpansion: true,
    },
    "mutation-state-evidence": {
      closureTrack: "mutation-state",
      proofLevelBand: "L3 Behaviour Proven",
      severity: "high",
      remediationEffort: "medium",
      exactClosureAction:
        "Emit before-state and after-state snapshots for the mutation route proof and assert the state diff.",
      blocksCurrentL3Milestone: false,
      blocksFutureSubstrateExpansion: true,
    },
    "behaviour-proof-incomplete": {
      closureTrack: "behaviour-closure",
      proofLevelBand: "L3 Behaviour Proven",
      severity: "critical",
      remediationEffort: "medium",
      exactClosureAction:
        "Close the missing behavioural evidence fields before any substrate proof can be promoted.",
      blocksCurrentL3Milestone: true,
      blocksFutureSubstrateExpansion: true,
    },
    "capability-behaviour-proof-missing": {
      closureTrack: "behaviour-closure",
      proofLevelBand: "L3 Behaviour Proven",
      severity: "critical",
      remediationEffort: "medium",
      exactClosureAction:
        "Add complete Behaviour Proven evidence for the capability or remove the unsupported behavioural claim.",
      blocksCurrentL3Milestone: true,
      blocksFutureSubstrateExpansion: true,
    },
    "in-memory-provider-parity": {
      closureTrack: "in-memory-parity",
      proofLevelBand: "L2 Contract Proven",
      severity: "critical",
      remediationEffort: "medium",
      exactClosureAction:
        "Restore provider parity evidence showing port, semantic, failure, event, audit, and observability contract alignment.",
      blocksCurrentL3Milestone: true,
      blocksFutureSubstrateExpansion: true,
    },
  };
  return (
    classifications[kind] || {
      closureTrack: "formal-assurance",
      proofLevelBand: "cross-level",
      severity: "high",
      remediationEffort: "medium",
      exactClosureAction:
        "Repair the emitted runtime evidence or explicit proof mapping so the strict formal gate can validate it.",
      blocksCurrentL3Milestone: kind.includes("behaviour"),
      blocksFutureSubstrateExpansion: true,
    }
  );
}

function normalizePerCapabilityL4Evidence(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((entry) => entry && typeof entry === "object");
  if (typeof value === "object") {
    return Object.entries(value).map(([capability, entry]) => ({
      capability,
      ...(entry && typeof entry === "object" ? entry : {}),
    }));
  }
  return [];
}

function evaluateCapabilityL4Evidence(capability, record) {
  const perCapability = normalizePerCapabilityL4Evidence(record.perCapabilityL4Evidence);
  const matchingEntries = perCapability.filter((entry) =>
    sameCapabilityName(
      entry.capability || entry.capabilityId || entry.capabilityName,
      capability.capability
    )
  );
  const directMatch =
    matchingEntries.length === 0 && directCapabilityRecordMatch(capability, record) ? [record] : [];
  const entries = matchingEntries.length > 0 ? matchingEntries : directMatch;
  const gaps = [];
  if (observedLevelFromEvidence(record) < 4) gaps.push("l4-proof-not-observed");
  if (entries.length === 0) {
    gaps.push(
      perCapability.length > 0
        ? "l4-proof-missing-this-capability"
        : "umbrella-l4-proof-missing-per-capability-evidence"
    );
  }
  const entryEvaluations = entries.map((entry) => evaluateL4Entry(record, entry));
  for (const entryEvaluation of entryEvaluations) {
    for (const gap of entryEvaluation.gaps) gaps.push(gap);
  }
  const valid = gaps.length === 0 && entryEvaluations.length > 0;
  return {
    proofId: record.proofId,
    providerMode: record.providerMode,
    valid,
    gaps: uniq(gaps),
    realImplementationPathExecuted:
      valid &&
      entryEvaluations.every((entryEvaluation) => entryEvaluation.realImplementationPathExecuted),
    composeLocalEvidence:
      valid && entryEvaluations.every((entryEvaluation) => entryEvaluation.composeLocalEvidence),
    stateDiffEvidence:
      valid && entryEvaluations.every((entryEvaluation) => entryEvaluation.stateDiffEvidence),
    sideEffectsEvidence:
      valid && entryEvaluations.every((entryEvaluation) => entryEvaluation.sideEffectsEvidence),
    failurePathEvidence:
      valid && entryEvaluations.every((entryEvaluation) => entryEvaluation.failurePathEvidence),
    observabilityEvidence:
      valid && entryEvaluations.every((entryEvaluation) => entryEvaluation.observabilityEvidence),
    telemetryEvidence: mergeL4EntryTelemetry(entryEvaluations),
  };
}

function evaluateL4Entry(record, entry) {
  const gaps = [];
  const substrate = firstMeaningful(
    entry.substrateUsed,
    entry.substrate,
    entry.requiredComposeSubstrates,
    entry.composeSubstrate,
    entry.composeService
  );
  const realAdapter = firstMeaningful(
    entry.realAdapterProviderUsed,
    entry.realAdapterOrProviderUsed,
    entry.realProviderUsed,
    entry.realImplementationPathExecuted,
    entry.realImplementationPath,
    record.realImplementationPathExecuted
  );
  const l3Contract = firstMeaningful(
    entry.l3ContractProofReused,
    entry.l3ContractProofIds,
    entry.l3BehaviourContractProofIds,
    entry.l3ProofHarnessReused,
    entry.existingL3ProofHarnessToReuse
  );
  const beforeState = entry.beforeState || entry.before;
  const afterState = entry.afterState || entry.after;
  const stateDiff = entry.stateDiff || entry.assertedStateDiff || entry.diff;
  const sideEffects = firstMeaningful(
    entry.sideEffectsEvidence,
    entry.sideEffectsAsserted,
    entry.sideEffects
  );
  const failurePath = firstMeaningful(
    entry.failurePathEvidence,
    entry.failurePathExercised,
    entry.failureMode
  );
  const auditEvidence = firstMeaningful(entry.auditEvidence, entry.auditEventIds, entry.auditIds);
  const metricEvidence = firstMeaningful(entry.metricEvidence, entry.metricSamples, entry.metrics);
  const traceEvidence = firstMeaningful(entry.traceEvidence, entry.traceIds, entry.traces);
  const logEvidence = firstMeaningful(entry.logEvidence, entry.logCorrelationIds, entry.logs);
  const result = String(entry.result || entry.status || "PASS").toUpperCase();
  if (!isMeaningfulEvidence(substrate)) gaps.push("missing-l4-substrate-used");
  if (!isMeaningfulEvidence(realAdapter)) gaps.push("missing-l4-real-adapter-provider");
  if (!isMeaningfulEvidence(l3Contract)) gaps.push("missing-l4-l3-contract-reuse");
  if (!isMeaningfulObject(beforeState)) gaps.push("missing-l4-before-state");
  if (!isMeaningfulObject(afterState)) gaps.push("missing-l4-after-state");
  if (!isMeaningfulObject(stateDiff)) gaps.push("missing-l4-state-diff");
  if (!isMeaningfulEvidence(sideEffects)) gaps.push("missing-l4-side-effects");
  if (!isMeaningfulEvidence(failurePath)) gaps.push("missing-l4-failure-path");
  if (!isMeaningfulEvidence(auditEvidence)) gaps.push("missing-l4-audit-evidence");
  if (!isMeaningfulEvidence(metricEvidence)) gaps.push("missing-l4-metric-evidence");
  if (!isMeaningfulEvidence(traceEvidence) && !isMeaningfulEvidence(logEvidence)) {
    gaps.push("missing-l4-trace-log-evidence");
  }
  if (result !== "PASS" && result !== "PASSED") gaps.push("l4-per-capability-result-not-pass");
  return {
    gaps,
    realImplementationPathExecuted: isMeaningfulEvidence(realAdapter),
    composeLocalEvidence:
      record.providerMode === "compose-local" && record.realLocalProviderUsed === true,
    stateDiffEvidence: isMeaningfulObject(stateDiff),
    sideEffectsEvidence: isMeaningfulEvidence(sideEffects),
    failurePathEvidence: isMeaningfulEvidence(failurePath),
    observabilityEvidence:
      isMeaningfulEvidence(auditEvidence) &&
      isMeaningfulEvidence(metricEvidence) &&
      (isMeaningfulEvidence(traceEvidence) || isMeaningfulEvidence(logEvidence)),
    telemetryEvidence: {
      proofEmittedTelemetry: {
        auditEventIds: evidenceArray(auditEvidence),
        metricSamples: evidenceArray(metricEvidence),
        traceIds: evidenceArray(traceEvidence),
        logCorrelationIds: evidenceArray(logEvidence),
      },
      observedSubstrateTelemetry: {
        auditRecords: entry.observedAuditRecords || [],
        metrics: entry.observedMetrics || [],
        traces: entry.observedTraces || [],
        logs: entry.observedLogs || [],
      },
    },
  };
}

function mergeL4EntryTelemetry(entryEvaluations) {
  const proofEmittedTelemetry = {
    auditEventIds: [],
    metricSamples: [],
    traceIds: [],
    logCorrelationIds: [],
  };
  const observedSubstrateTelemetry = {
    auditRecords: [],
    metrics: [],
    traces: [],
    logs: [],
  };
  for (const entry of entryEvaluations) {
    proofEmittedTelemetry.auditEventIds.push(
      ...(entry.telemetryEvidence?.proofEmittedTelemetry?.auditEventIds || [])
    );
    proofEmittedTelemetry.metricSamples.push(
      ...(entry.telemetryEvidence?.proofEmittedTelemetry?.metricSamples || [])
    );
    proofEmittedTelemetry.traceIds.push(
      ...(entry.telemetryEvidence?.proofEmittedTelemetry?.traceIds || [])
    );
    proofEmittedTelemetry.logCorrelationIds.push(
      ...(entry.telemetryEvidence?.proofEmittedTelemetry?.logCorrelationIds || [])
    );
    observedSubstrateTelemetry.auditRecords.push(
      ...(entry.telemetryEvidence?.observedSubstrateTelemetry?.auditRecords || [])
    );
    observedSubstrateTelemetry.metrics.push(
      ...(entry.telemetryEvidence?.observedSubstrateTelemetry?.metrics || [])
    );
    observedSubstrateTelemetry.traces.push(
      ...(entry.telemetryEvidence?.observedSubstrateTelemetry?.traces || [])
    );
    observedSubstrateTelemetry.logs.push(
      ...(entry.telemetryEvidence?.observedSubstrateTelemetry?.logs || [])
    );
  }
  return {
    proofEmittedTelemetry: {
      auditEventIds: uniq(proofEmittedTelemetry.auditEventIds),
      metricSamples: proofEmittedTelemetry.metricSamples,
      traceIds: uniq(proofEmittedTelemetry.traceIds),
      logCorrelationIds: uniq(proofEmittedTelemetry.logCorrelationIds),
    },
    observedSubstrateTelemetry,
  };
}

function evidenceArray(value) {
  if (!isMeaningfulEvidence(value)) return [];
  return Array.isArray(value) ? value : [value];
}

function directCapabilityRecordMatch(capability, record) {
  const directNames = [
    record.capability,
    record.capabilityName,
    record.capabilityId,
    String(record.capabilityId || "").replace(/^capability:/, ""),
  ];
  return (
    directNames.some((name) => sameCapabilityName(name, capability.capability)) &&
    isMeaningfulEvidence(
      record.l3ContractProofReused ||
        record.l3ContractProofIds ||
        record.l3BehaviourContractProofIds ||
        record.l3ProofHarnessReused
    )
  );
}

function sameCapabilityName(left, right) {
  return normalizeCapabilityName(left) === normalizeCapabilityName(right);
}

function normalizeCapabilityName(value) {
  return String(value || "")
    .replace(/^capability:/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function firstMeaningful(...values) {
  return values.find(isMeaningfulEvidence);
}

function l4CapabilityGapMessage(kind, capability) {
  const messages = {
    "l4-blocked-by-missing-l0": "L4 blocked because L0 Discovery Proven is missing.",
    "l4-blocked-by-missing-l1": "L4 blocked because L1 Executable Proven is missing.",
    "l4-blocked-by-missing-l2": "L4 blocked because L2 Contract Proven is missing.",
    "l4-blocked-by-missing-l3": "L4 blocked because L3 Behaviour Proven is missing.",
    "missing-l4-substrate-proof": "No L4 proof evidence is mapped to this capability.",
    "missing-per-capability-l4-evidence":
      "Mapped L4 proof evidence does not include a valid per-capability substrate evidence record.",
    "umbrella-l4-proof-missing-per-capability-evidence":
      "Umbrella L4 proof cannot certify this capability without explicit per-capability evidence.",
    "l4-proof-missing-this-capability":
      "L4 proof has per-capability evidence but does not enumerate this capability.",
    "l4-proof-not-observed": "Mapped proof did not observe L4 strength.",
    "missing-l4-substrate-used": "Per-capability L4 evidence must name the real substrate used.",
    "missing-l4-real-adapter-provider":
      "Per-capability L4 evidence must name the real adapter/provider executed.",
    "missing-l4-l3-contract-reuse":
      "Per-capability L4 evidence must identify the certified L3 contract reused.",
    "missing-l4-before-state": "Per-capability L4 evidence must capture before-state.",
    "missing-l4-after-state": "Per-capability L4 evidence must capture after-state.",
    "missing-l4-state-diff": "Per-capability L4 evidence must assert state diff.",
    "missing-l4-side-effects": "Per-capability L4 evidence must assert side effects.",
    "missing-l4-failure-path": "Per-capability L4 evidence must exercise a failure path.",
    "missing-l4-audit-evidence": "Per-capability L4 evidence must include audit evidence.",
    "missing-l4-metric-evidence": "Per-capability L4 evidence must include metric evidence.",
    "missing-l4-trace-log-evidence":
      "Per-capability L4 evidence must include trace or log evidence.",
    "l4-per-capability-result-not-pass": "Per-capability L4 evidence result is not PASS.",
  };
  return `${capability}: ${messages[kind] || kind}`;
}

function buildReadinessConsistencyGaps({
  capabilityReadiness,
  l4SubstrateEvidence,
  strengthMatrix,
  ladderCompliance,
}) {
  const gaps = [];
  const capabilityL4Count = capabilityReadiness.ladderLevelDistribution?.L4 || 0;
  const readinessL4Count = capabilityReadiness.readinessCounts?.SUBSTRATE_PROVEN || 0;
  const l4EvidenceCount = l4SubstrateEvidence.substrateProvenCapabilities || 0;
  const strengthL4Count = strengthMatrix.byObservedLevel?.L4 || 0;
  const ladderObservedL4Count = (ladderCompliance.records || []).filter(
    (record) => record.proofLevelObserved === "L4"
  ).length;
  if (capabilityL4Count !== readinessL4Count) {
    gaps.push({
      kind: "capability-readiness-l4-count-disagreement",
      message: `ladderLevelDistribution.L4=${capabilityL4Count} but readinessCounts.SUBSTRATE_PROVEN=${readinessL4Count}`,
    });
  }
  if (capabilityL4Count !== l4EvidenceCount) {
    gaps.push({
      kind: "capability-l4-evidence-disagreement",
      message: `capability readiness L4 count ${capabilityL4Count} disagrees with l4-substrate-evidence-report count ${l4EvidenceCount}`,
    });
  }
  if (strengthL4Count !== l4SubstrateEvidence.observedL4ProofCount) {
    gaps.push({
      kind: "proof-strength-l4-observed-disagreement",
      message: `proof-strength-matrix observed L4 count ${strengthL4Count} disagrees with l4 evidence observed proof count ${l4SubstrateEvidence.observedL4ProofCount}`,
    });
  }
  if (ladderObservedL4Count !== strengthL4Count) {
    gaps.push({
      kind: "ladder-compliance-strength-l4-disagreement",
      message: `proof-ladder-compliance observed L4 count ${ladderObservedL4Count} disagrees with proof-strength-matrix observed L4 count ${strengthL4Count}`,
    });
  }
  for (const row of capabilityReadiness.capabilities || []) {
    if (row.readiness === "SUBSTRATE_PROVEN" && row.highestSubstrateLevelAchieved !== "L4") {
      gaps.push({
        kind: "substrate-proven-without-l4",
        capability: row.capability,
        message: `${row.capability} is SUBSTRATE_PROVEN but highestSubstrateLevelAchieved is ${row.highestSubstrateLevelAchieved}`,
      });
    }
    if (
      row.highestSubstrateLevelAchieved === "L4" &&
      row.currentClosureTarget === "L3 Behaviour Proven"
    ) {
      gaps.push({
        kind: "post-l4-stale-closure-target",
        capability: row.capability,
        message: `${row.capability} is L4 but currentClosureTarget still points to L3`,
      });
    }
    const staleL5Blocker = (row.advancementBlockers || []).some(
      (blocker) =>
        blocker.targetLevel === "L5" &&
        blocker.blockedBy === "L4" &&
        row.highestSubstrateLevelAchieved === "L4"
    );
    if (staleL5Blocker) {
      gaps.push({
        kind: "post-l4-stale-l5-blocker",
        capability: row.capability,
        message: `${row.capability} is L4 but L5 is reported as blocked by missing L4`,
      });
    }
  }
  if (
    capabilityL4Count === capabilityReadiness.capabilityCount &&
    l4EvidenceCount !== capabilityReadiness.capabilityCount
  ) {
    gaps.push({
      kind: "post-l4-l4-count-substrate-count-disagreement",
      message: `L4=${capabilityL4Count} but substrateProvenCapabilityCount=${l4EvidenceCount}`,
    });
  }
  if ((l4SubstrateEvidence.invalidL4Claims || 0) > 0) {
    gaps.push({
      kind: "post-l4-invalid-l4-claims",
      message: `invalidL4Claims=${l4SubstrateEvidence.invalidL4Claims}`,
    });
  }
  if (
    (l4SubstrateEvidence.perCapabilityL4Evidence || []).length !==
    l4SubstrateEvidence.totalCapabilities
  ) {
    gaps.push({
      kind: "post-l4-missing-per-capability-l4-evidence",
      message: `perCapabilityL4Evidence has ${(l4SubstrateEvidence.perCapabilityL4Evidence || []).length} entries for ${l4SubstrateEvidence.totalCapabilities} capabilities`,
    });
  }
  return gaps;
}

function buildL4IntegrityGaps(rows) {
  const requiredBooleanFields = [
    "realImplementationPathExecuted",
    "composeLocalEvidence",
    "stateDiffEvidence",
    "sideEffectsEvidence",
    "failurePathEvidence",
    "observabilityEvidence",
  ];
  const gaps = [];
  for (const row of rows) {
    if (!isNonEmptyString(row.capability)) {
      gaps.push({
        kind: "l4-integrity-missing-capability-name",
        capability: row.capability || "unknown",
        message: "L4 evidence row is missing explicit capability name",
      });
    }
    if (!Array.isArray(row.l4EvidenceProofIds) || row.l4EvidenceProofIds.length === 0) {
      gaps.push({
        kind: "l4-integrity-missing-proof-ids",
        capability: row.capability,
        message: `${row.capability} has no l4EvidenceProofIds`,
      });
    }
    if (!(row.substrateProviderMode || []).includes("compose-local")) {
      gaps.push({
        kind: "l4-integrity-missing-compose-local",
        capability: row.capability,
        message: `${row.capability} does not include compose-local substrate provider mode`,
      });
    }
    for (const field of requiredBooleanFields) {
      if (row[field] !== true) {
        gaps.push({
          kind: `l4-integrity-${field}`,
          capability: row.capability,
          message: `${row.capability} must have ${field}=true`,
        });
      }
    }
    if ((row.gaps || []).length > 0) {
      gaps.push({
        kind: "l4-integrity-row-has-gaps",
        capability: row.capability,
        message: `${row.capability} has L4 row gaps`,
      });
    }
  }
  return gaps;
}

function mergeL4TelemetryEvidence(evaluations) {
  const generated = {
    auditEventIds: [],
    metricSamples: [],
    traceIds: [],
    logCorrelationIds: [],
  };
  const observed = {
    auditRecords: [],
    metrics: [],
    traces: [],
    logs: [],
  };
  for (const evaluation of evaluations) {
    const telemetry = evaluation.telemetryEvidence || {};
    generated.auditEventIds.push(...(telemetry.proofEmittedTelemetry?.auditEventIds || []));
    generated.metricSamples.push(...(telemetry.proofEmittedTelemetry?.metricSamples || []));
    generated.traceIds.push(...(telemetry.proofEmittedTelemetry?.traceIds || []));
    generated.logCorrelationIds.push(...(telemetry.proofEmittedTelemetry?.logCorrelationIds || []));
    observed.auditRecords.push(...(telemetry.observedSubstrateTelemetry?.auditRecords || []));
    observed.metrics.push(...(telemetry.observedSubstrateTelemetry?.metrics || []));
    observed.traces.push(...(telemetry.observedSubstrateTelemetry?.traces || []));
    observed.logs.push(...(telemetry.observedSubstrateTelemetry?.logs || []));
  }
  return {
    classification: "proof-emitted-telemetry",
    note: "Audit, metric, trace, and log IDs in current L4 capability rows are proof-emitted correlation evidence unless observedSubstrateTelemetry is populated.",
    proofEmittedTelemetry: {
      auditEventIds: uniq(generated.auditEventIds),
      metricSamples: generated.metricSamples,
      traceIds: uniq(generated.traceIds),
      logCorrelationIds: uniq(generated.logCorrelationIds),
    },
    observedSubstrateTelemetry: observed,
  };
}

function restartScenariosForSubstrates(substrates) {
  return substrates.map((substrate) => substrateResilienceScenario(substrate).restartScenario);
}

function timeoutScenariosForSubstrates(substrates) {
  return substrates.map((substrate) => substrateResilienceScenario(substrate).timeoutScenario);
}

function retryScenariosForSubstrates(substrates) {
  return substrates.map((substrate) => substrateResilienceScenario(substrate).retryScenario);
}

function concurrencyScenariosForCapability(capability, substrates) {
  return [
    `${capability} concurrent requests preserve tenant isolation and idempotency`,
    ...substrates.map((substrate) => substrateResilienceScenario(substrate).concurrencyScenario),
  ];
}

function degradedModeScenariosForSubstrates(substrates) {
  return substrates.map(
    (substrate) => substrateResilienceScenario(substrate).degradedOperationScenario
  );
}

function backupRestoreScenariosForSubstrates(substrates) {
  return substrates.map(
    (substrate) => substrateResilienceScenario(substrate).backupRestoreScenario
  );
}

function failoverRecoveryScenariosForSubstrates(substrates) {
  return substrates.map((substrate) => substrateResilienceScenario(substrate).failoverScenario);
}

function substrateResilienceScenario(substrate) {
  const text = String(substrate || "");
  const lower = text.toLowerCase();
  if (lower.includes("postgres")) {
    return {
      substrate: text,
      restartScenario: "Postgres restart preserves committed tenant rows and replayed L3 behaviour",
      timeoutScenario:
        "Postgres query timeout returns typed failure without partial state mutation",
      retryScenario:
        "Postgres transient connection loss retries idempotent operations without duplicate rows",
      concurrencyScenario:
        "Postgres concurrent mutations preserve RLS/tenant isolation and state diff invariants",
      degradedOperationScenario:
        "Postgres unavailable mode reports degraded readiness and blocks unsafe writes",
      recoveryScenario:
        "Postgres reconnect restores certified L4 behaviour using existing migrations/schema",
      backupRestoreScenario:
        "Postgres backup/restore preserves tenant state, audit rows, and L4 replay contract",
      failoverScenario: "Postgres failover or reconnection returns to certified L4 baseline",
    };
  }
  if (lower.includes("redis")) {
    return {
      substrate: text,
      restartScenario:
        "Redis restart preserves or explicitly rebuilds rate-limit/session-derived state",
      timeoutScenario: "Redis timeout degrades safely without granting extra quota or access",
      retryScenario: "Redis transient failure retries without double-counting counters",
      concurrencyScenario: "Redis concurrent increments preserve atomic limit semantics",
      degradedOperationScenario:
        "Redis unavailable mode fails closed for rate limiting and exposes degraded readiness",
      recoveryScenario:
        "Redis recovery resumes counters consistently with documented TTL semantics",
      backupRestoreScenario:
        "Redis volatile state non-applicability is documented or snapshot restore is asserted where configured",
      failoverScenario: "Redis failover preserves atomic counter semantics after reconnect",
    };
  }
  if (lower.includes("minio") || lower.includes("object") || lower.includes("storage")) {
    return {
      substrate: text,
      restartScenario: "MinIO restart preserves tenant object prefixes and signed-object behaviour",
      timeoutScenario:
        "MinIO timeout returns typed storage failure without exposing partial downloads",
      retryScenario:
        "MinIO retry completes idempotent object writes without duplicate tenant-visible objects",
      concurrencyScenario: "MinIO concurrent tenant object operations preserve prefix isolation",
      degradedOperationScenario:
        "MinIO unavailable mode blocks unsafe object mutations and reports degraded readiness",
      recoveryScenario: "MinIO recovery restores object read/write/delete lifecycle behaviour",
      backupRestoreScenario:
        "MinIO backup/restore preserves object bytes, metadata, and tenant prefix boundaries",
      failoverScenario: "MinIO failover/reconnect preserves object lifecycle semantics",
    };
  }
  if (lower.includes("openbao") || lower.includes("secret")) {
    return {
      substrate: text,
      restartScenario:
        "OpenBao restart preserves secret readability only after valid unseal/health state",
      timeoutScenario: "OpenBao timeout fails closed for secret reads and writes",
      retryScenario:
        "OpenBao transient failure retries do not duplicate secret versions unexpectedly",
      concurrencyScenario:
        "OpenBao concurrent secret rotations preserve version and permission semantics",
      degradedOperationScenario:
        "OpenBao unavailable mode blocks secret-dependent mutations and reports degraded readiness",
      recoveryScenario: "OpenBao recovery restores typed secret resolution and audit behaviour",
      backupRestoreScenario:
        "OpenBao backup/restore preserves secret metadata and access boundaries",
      failoverScenario:
        "OpenBao failover preserves secret access policy and sealed/unsealed safety",
    };
  }
  if (lower.includes("keycloak") || lower.includes("idp") || lower.includes("oidc")) {
    return {
      substrate: text,
      restartScenario:
        "Keycloak restart preserves realm discovery, issuer, JWKS, and client configuration behaviour",
      timeoutScenario:
        "Keycloak timeout triggers static fallback only where explicitly allowed and fails closed otherwise",
      retryScenario:
        "Keycloak transient authz failure retries without granting unauthorised access",
      concurrencyScenario: "Keycloak concurrent auth checks preserve tenant and policy boundaries",
      degradedOperationScenario:
        "Keycloak unavailable mode distinguishes degraded fallback from sole-UMA fail-closed routes",
      recoveryScenario: "Keycloak recovery restores OIDC discovery and policy-decision behaviour",
      backupRestoreScenario:
        "Keycloak realm/client backup restore preserves issuer and callback semantics",
      failoverScenario: "Keycloak failover preserves realm discovery and policy decision behaviour",
    };
  }
  if (lower.includes("temporal") || lower.includes("workflow")) {
    return {
      substrate: text,
      restartScenario: "Temporal restart preserves workflow state and resumes scheduled work",
      timeoutScenario: "Temporal activity timeout records typed failure and respects retry policy",
      retryScenario: "Temporal retry resumes workflow without duplicate side effects",
      concurrencyScenario: "Temporal concurrent workflow starts preserve workflow ID idempotency",
      degradedOperationScenario:
        "Temporal unavailable mode reports degraded workflow readiness and queues or blocks work safely",
      recoveryScenario: "Temporal recovery resumes workflow execution from durable history",
      backupRestoreScenario:
        "Temporal persistence backup/restore preserves workflow histories where configured",
      failoverScenario: "Temporal worker or service failover resumes durable workflow progress",
    };
  }
  if (lower.includes("windmill") || lower.includes("automation")) {
    return {
      substrate: text,
      restartScenario: "Windmill restart preserves job visibility and access-boundary behaviour",
      timeoutScenario: "Windmill job timeout records failure without orphaned privileged execution",
      retryScenario: "Windmill retry preserves idempotent automation semantics",
      concurrencyScenario:
        "Windmill concurrent job submissions preserve tenant and permission boundaries",
      degradedOperationScenario:
        "Windmill unavailable mode blocks automation mutations and reports degraded readiness",
      recoveryScenario: "Windmill recovery resumes safe job dispatch and preserves audit trail",
      backupRestoreScenario:
        "Windmill backup/restore preserves job definitions and access controls where configured",
      failoverScenario: "Windmill worker failover does not duplicate non-idempotent jobs",
    };
  }
  if (/observability|prometheus|grafana|loki|tempo|metrics|traces|logs/i.test(text)) {
    return {
      substrate: text,
      restartScenario:
        "Observability stack restart preserves scrape/readiness and log/trace ingestion continuity",
      timeoutScenario:
        "Observability timeout does not block core mutations and records degraded telemetry state",
      retryScenario:
        "Observability export retries avoid duplicate misleading metric samples where possible",
      concurrencyScenario:
        "Observability concurrent telemetry ingestion preserves tenant correlation labels",
      degradedOperationScenario:
        "Observability unavailable mode reports degraded visibility without fabricating green health",
      recoveryScenario:
        "Observability recovery resumes audit, metric, trace, and log correlation visibility",
      backupRestoreScenario:
        "Observability retention/backup preserves incident-relevant telemetry where configured",
      failoverScenario:
        "Observability failover preserves alerting and trace/log query continuity where applicable",
    };
  }
  return {
    substrate: text,
    restartScenario: `${text} restart preserves certified L4 behaviour`,
    timeoutScenario: `${text} timeout fails closed or returns typed degraded state`,
    retryScenario: `${text} transient failure is retried without duplicate side effects`,
    concurrencyScenario: `${text} concurrent mutation pressure preserves state diff invariants`,
    degradedOperationScenario: `${text} unavailable mode exposes degraded readiness and blocks unsafe mutations`,
    recoveryScenario: `${text} recovery returns to certified L4 behaviour`,
    backupRestoreScenario: `${text} backup/restore applicability is proven or documented as not applicable`,
    failoverScenario: `${text} failover/recovery returns to certified L4 baseline where applicable`,
  };
}

function resilienceRiskLevel(substrates, migrationEffort) {
  const joined = substrates.join(" ");
  if (/postgres|minio|openbao|keycloak|temporal|windmill/i.test(joined)) return "high";
  if (migrationEffort === "large" || substrates.length > 2) return "high";
  if (migrationEffort === "medium" || /redis|lago|smtp|clamav/i.test(joined)) return "medium";
  return "low";
}

function resilienceImplementationOrder(riskLevel, substrates) {
  const priority = { high: 1, medium: 2, low: 3 };
  const substrateWeight = substrates.some((substrate) => /postgres/i.test(substrate)) ? 0 : 1;
  return priority[riskLevel] * 100 + substrateWeight * 10 + substrates.length;
}

function recommendedFirstL5Target(rows) {
  const first = [...rows]
    .filter((row) => row.currentReadiness === "SUBSTRATE_PROVEN")
    .sort((a, b) => a.recommendedImplementationOrder - b.recommendedImplementationOrder)[0];
  if (!first) return null;
  return {
    capability: first.capability,
    substrates: first.substratesInvolved,
    proposedL5ProofCommand: first.proposedL5ProofCommand,
    rationale: "Highest-risk, lowest-order substrate target for beginning resilience proof work.",
  };
}

function proofAliasForScript(scriptPath, packageJsonScripts = {}) {
  return (
    Object.entries(packageJsonScripts).find(
      ([name, command]) => name.startsWith("proof:") && String(command).includes(scriptPath)
    )?.[0] || null
  );
}

function providerEvidenceClass(record) {
  if (record.fakeProviderUsed) return "fake-http-adapter-proof";
  if (record.inMemoryProviderUsed) return "in-memory-provider-proof";
  if (record.realLocalProviderUsed) return "local-real-provider-proof";
  if (record.externalSandboxProviderUsed) return "external-sandbox-proof";
  return "contract-or-unit-proof";
}

function validFixtureRecord(ctx) {
  return {
    proofId: "negative:valid-base",
    subjectType: "runtime-proof",
    subjectIds: ["proof:negative-control"],
    subjectId: "proof:negative-control",
    capabilityId: "capability:negative-control",
    providerId: "provider:negative-control",
    routeIds: ["route:negative-control"],
    workflowIds: ["workflow:negative-control"],
    eventIds: ["event:negative-control"],
    storageIds: ["storage:negative-control"],
    environmentMode: "test",
    providerMode: "compose-local",
    proofLevelClaimed: "L4",
    commandExecuted: "node negative-control.js",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:01.000Z",
    exitStatus: 0,
    commit: ctx.headCommit,
    realImplementationPathExecuted: "negative-control.js",
    mockProviderUsed: false,
    fakeProviderUsed: false,
    inMemoryProviderUsed: false,
    realLocalProviderUsed: true,
    externalSandboxProviderUsed: false,
    externalSandboxRequestIds: [],
    beforeState: { rows: 0 },
    afterState: { rows: 1 },
    assertedStateDiff: { rows: { before: 0, after: 1 } },
    failurePathExercised: true,
    sideEffectsAsserted: true,
    tenantBoundaryAsserted: true,
    securityBoundaryAsserted: true,
    auditEventIds: ["audit-negative-control"],
    traceIds: ["0123456789abcdef0123456789abcdef"],
    metricSamples: [{ name: "proof.negative_control", value: 1 }],
    logCorrelationIds: ["log-negative-control"],
    cleanupResult: { status: "verified" },
    deterministicReplaySupported: true,
    skipped: false,
    skipReason: null,
    generatedAt: "2026-01-01T00:00:01.000Z",
    sourceFileRefs: ["negative-control.js"],
    evidenceEmitter: "proof-process",
    collectorRunId: "negative-control-run",
    assertionsObserved: true,
    expectedOutputsAsserted: true,
  };
}

export function signRecord(record) {
  const signed = withEvidenceAliases({ ...record });
  signed.evidenceSignature = evidenceSignature(signed);
  return signed;
}

function withEvidenceAliases(record) {
  const environmentMode = record.environmentMode || record.environment || "unknown";
  const startedAt = record.startedAt || record.startTime || null;
  const endedAt = record.endedAt || record.endTime || null;
  const commit = record.commit || record.gitCommit || null;
  const assertedStateDiff = record.assertedStateDiff || record.stateDiff || {};
  const auditEventIds = record.auditEventIds || record.auditIds || [];
  const metricSamples = record.metricSamples || record.metricEvidence || [];
  const logCorrelationIds = record.logCorrelationIds || record.logEvidence || [];
  return {
    ...record,
    environmentMode,
    environment: record.environment || environmentMode,
    proofLevelObserved:
      record.proofLevelObserved || proofLevelId(observedLevelFromEvidence(record)),
    startedAt,
    startTime: record.startTime || startedAt,
    endedAt,
    endTime: record.endTime || endedAt,
    commit,
    gitCommit: record.gitCommit || commit,
    executionTimestamp: record.executionTimestamp || record.generatedAt || endedAt,
    assertedStateDiff,
    stateDiff: record.stateDiff || assertedStateDiff,
    failureMode:
      record.failureMode || (record.failurePathExercised === true ? "exercised" : "not-exercised"),
    auditEventIds,
    auditIds: record.auditIds || auditEventIds,
    metricSamples,
    metricEvidence: record.metricEvidence || metricSamples,
    logCorrelationIds,
    logEvidence: record.logEvidence || logCorrelationIds,
    evidenceEmitter: record.evidenceEmitter || "unknown",
    collectorRunId: record.collectorRunId || null,
    assertionsObserved: record.assertionsObserved === true,
    expectedOutputsAsserted: record.expectedOutputsAsserted === true,
  };
}

function realProviderFor(provider) {
  const map = {
    "in-memory-antivirus": "clamav-antivirus",
    "in-memory-automation-runner": "windmill-automation-provider",
    "in-memory-backup-restore-provider": "backup-restore-scripts",
    "in-memory-billing-provider": "lago-billing-provider",
    "in-memory-event-bus": "postgres-event-bus",
    "in-memory-identity-repository": "postgres-identity-repository",
    "in-memory-notification-transport": "smtp-email-adapter",
    "in-memory-object-storage": "s3-object-storage-adapter",
    "in-memory-observability-repository": "postgres-observability-repository",
    "in-memory-rate-limit-repository": "redis-rate-limit-repository",
    "in-memory-search-repository": "postgres-search-repository",
    "in-memory-secret-store": "openbao-secret-store",
    "in-memory-webhook-dispatcher": "http-webhook-dispatcher",
    "in-memory-workflow-orchestrator": "temporal-workflow-provider",
    "in-memory-semantic-provider": "not-runtime-static-provider-factory",
    "in-memory-semantic-providers": "not-runtime-shared-provider-substrate",
  };
  return map[provider] || "unknown";
}

function observabilitySubject(record) {
  if (record.subjectType === "route-proof") return false;
  return /observability|metrics?|traces?|logs?|spans?/i.test(
    [record.subjectId, record.providerId, ...(record.subjectIds || [])].join(" ")
  );
}

function observabilityComplete(record) {
  return (
    (record.auditEventIds || []).length > 0 &&
    (record.traceIds || []).length > 0 &&
    (record.metricSamples || []).length > 0 &&
    (record.logCorrelationIds || []).length > 0
  );
}

function behaviourGaps(record) {
  const gaps = [];
  if (!isMeaningfulObject(record.beforeState)) {
    gaps.push({
      kind: "missing-before-state",
      message: "L3 Behaviour Proven requires before-state evidence",
    });
  }
  if (!isMeaningfulObject(record.afterState)) {
    gaps.push({
      kind: "missing-after-state",
      message: "L3 Behaviour Proven requires after-state evidence",
    });
  }
  if (!isMeaningfulObject(record.assertedStateDiff)) {
    gaps.push({
      kind: "missing-asserted-state-diff",
      message: "L3 Behaviour Proven requires asserted state diff evidence",
    });
  }
  if (record.sideEffectsAsserted !== true) {
    gaps.push({
      kind: "missing-side-effect-assertion",
      message: "L3 Behaviour Proven requires side-effect assertion",
    });
  }
  if (record.failurePathExercised !== true) {
    gaps.push({
      kind: "missing-failure-path-evidence",
      message: "L3 Behaviour Proven requires exercised failure-path evidence",
    });
  }
  if ((record.auditEventIds || []).length === 0) {
    gaps.push({
      kind: "missing-audit-evidence",
      message: "L3 Behaviour Proven requires audit evidence",
    });
  }
  if ((record.metricSamples || []).length === 0) {
    gaps.push({
      kind: "missing-metric-evidence",
      message: "L3 Behaviour Proven requires metric evidence",
    });
  }
  if ((record.traceIds || []).length === 0) {
    gaps.push({
      kind: "missing-trace-evidence",
      message: "L3 Behaviour Proven requires trace evidence",
    });
  }
  if (record.tenantBoundaryAsserted !== true) {
    gaps.push({
      kind: "missing-tenant-boundary-evidence",
      message: "L3 Behaviour Proven requires tenant-boundary evidence",
    });
  }
  if (record.securityBoundaryAsserted !== true) {
    gaps.push({
      kind: "missing-security-boundary-evidence",
      message: "L3 Behaviour Proven requires security-boundary evidence",
    });
  }
  if (record.deterministicReplaySupported !== true) {
    gaps.push({
      kind: "missing-deterministic-replay-evidence",
      message: "L3 Behaviour Proven requires deterministic replay evidence",
    });
  }
  return gaps;
}

function contractGaps(record) {
  const gaps = [];
  if (record.exitStatus !== 0) {
    gaps.push({
      kind: "proof-command-failed",
      message: "L1 Executable Proven requires proof command success",
    });
  }
  if (record.assertionsObserved !== true) {
    gaps.push({
      kind: "missing-contract-assertions",
      message: "L2 Contract Proven requires interface/input/output/permission assertions",
    });
  }
  if (record.expectedOutputsAsserted !== true) {
    gaps.push({
      kind: "missing-expected-output-assertions",
      message: "L2 Contract Proven requires expected output assertions",
    });
  }
  return gaps;
}

function substrateGaps(record) {
  const gaps = [];
  const priorSubstrateEvidence =
    proofLevelNumber(record.proofLevelClaimed) >= 5 &&
    isMeaningfulEvidence(record.substrateProofIds || record.l4EvidenceProofIds);
  if (behaviourGaps(record).length > 0) {
    gaps.push({
      kind: "l3-behaviour-incomplete",
      message: "L4 Substrate Proven requires complete L3 Behaviour Proven evidence first",
    });
  }
  if (record.realLocalProviderUsed !== true && !priorSubstrateEvidence) {
    gaps.push({
      kind: "missing-real-local-substrate",
      message: "L4 Substrate Proven requires real local substrate evidence",
    });
  }
  if (record.providerMode !== "compose-local" && !priorSubstrateEvidence) {
    gaps.push({
      kind: "missing-compose-local-provider-mode",
      message: "L4 Substrate Proven requires compose-local provider mode",
    });
  }
  if (
    (record.fakeProviderUsed === true || record.inMemoryProviderUsed === true) &&
    !priorSubstrateEvidence
  ) {
    gaps.push({
      kind: "substrate-provider-class-overclaim",
      message: "L4 Substrate Proven cannot be backed by fake or in-memory provider evidence",
    });
  }
  return gaps;
}

function resilienceGaps(record) {
  const gaps = [];
  if (substrateGaps(record).length > 0) {
    gaps.push({
      kind: "l4-substrate-incomplete",
      message: "L5 Resilience Proven requires complete L4 Substrate Proven evidence first",
    });
  }
  const localL5a = isL5aLocalResilienceShape(record);
  const requirements = [
    [
      ["restartEvidence", "restartOrReconnectEvidence"],
      "missing-restart-evidence",
      "restart/reconnect evidence",
    ],
    ["timeoutEvidence", "missing-timeout-evidence", "timeout evidence"],
    ["retryEvidence", "missing-retry-evidence", "retry evidence"],
    ["concurrencyEvidence", "missing-concurrency-evidence", "concurrency evidence"],
    ["recoveryEvidence", "missing-recovery-evidence", "recovery evidence"],
    ["degradedModeEvidence", "missing-degraded-mode-evidence", "degraded-mode evidence"],
    [
      "statePreservationEvidence",
      "missing-state-preservation-evidence",
      "state preservation evidence",
    ],
    [
      "behaviouralContinuityEvidence",
      "missing-behavioural-continuity-evidence",
      "behavioural continuity evidence",
    ],
    [
      "observabilityEvidence",
      "missing-resilience-observability-evidence",
      "observability evidence",
    ],
    [
      "failureInjectionEvidence",
      "missing-failure-injection-evidence",
      "failure injection evidence",
    ],
  ];
  if (!localL5a) {
    requirements.push([
      "backupRestoreEvidence",
      "missing-backup-restore-evidence",
      "backup/restore evidence",
    ]);
  }
  for (const [field, kind, label] of requirements) {
    if (!isMeaningfulEvidence(resilienceField(record, field))) {
      gaps.push({ kind, message: `L5 Resilience Proven requires ${label}` });
    }
  }
  return gaps;
}

function isL4SubstrateEvidenceCandidate(record) {
  return (
    !isL5aLocalResilienceShape(record) &&
    (observedLevelFromEvidence(record) >= 4 || proofLevelNumber(record.proofLevelClaimed) >= 4)
  );
}

function resilienceField(record, field) {
  const fields = Array.isArray(field) ? field : [field];
  for (const name of fields) {
    if (isMeaningfulEvidence(record[name])) return record[name];
    if (isMeaningfulEvidence(record.resilienceEvidence?.[name])) {
      return record.resilienceEvidence[name];
    }
  }
  return null;
}

function isL5aLocalResilienceShape(record) {
  return (
    record.localResiliencePhase === "L5A_COMPOSE_LOCAL" ||
    record.resilienceEvidence?.conclusion === "L5A_LOCAL_RESILIENCE_PROVEN"
  );
}

function isL5aLocalResilienceRecord(record) {
  const env = record.environmentMode || record.environment;
  return (
    isL5aLocalResilienceShape(record) &&
    env === "test" &&
    record.providerMode === "compose-local" &&
    record.realLocalProviderUsed === true &&
    record.inMemoryProviderUsed !== true &&
    record.fakeProviderUsed !== true &&
    resilienceGaps(record).length === 0
  );
}

function isFullL5ResilienceRecord(record) {
  const env = record.environmentMode || record.environment;
  return (
    (env === "staging" || env === "e2e") &&
    record.externalSandboxProviderUsed === true &&
    (record.externalSandboxRequestIds || []).length > 0 &&
    resilienceGaps(record).length === 0
  );
}

function l5LocalResilienceRecordGaps(record) {
  const gaps = [];
  const env = record.environmentMode || record.environment;
  if (!isL5aLocalResilienceShape(record)) gaps.push("missing-l5a-local-resilience-phase");
  if (env !== "test") gaps.push("l5a-environment-not-test");
  if (record.providerMode !== "compose-local") gaps.push("l5a-provider-mode-not-compose-local");
  if (record.realLocalProviderUsed !== true) gaps.push("l5a-real-local-provider-not-used");
  if (record.inMemoryProviderUsed === true) gaps.push("l5a-in-memory-provider-used");
  if (record.fakeProviderUsed === true) gaps.push("l5a-fake-provider-used");
  if (
    !isMeaningfulEvidence(
      record.l3EvidenceProofIds || record.resilienceEvidence?.l3EvidenceProofIds
    )
  ) {
    gaps.push("missing-l3-evidence-proof-ids");
  }
  if (
    !isMeaningfulEvidence(
      record.l4EvidenceProofIds || record.resilienceEvidence?.l4EvidenceProofIds
    )
  ) {
    gaps.push("missing-l4-evidence-proof-ids");
  }
  for (const gap of resilienceGaps(record)) gaps.push(gap.kind);
  return uniq(gaps);
}

function l5LocalResilienceEvidenceForCapability(record, capability) {
  const evidence = record.resilienceEvidence || {};
  const matches = resilienceRecordMatchesCapability(record, capability);
  const gaps = matches ? l5LocalResilienceRecordGaps(record) : ["capability-not-covered-by-record"];
  return {
    proofId: record.proofId,
    commandExecuted: record.commandExecuted,
    valid: gaps.length === 0,
    capability: evidence.capability || capability,
    substrate: evidence.substrate || null,
    environment: record.environmentMode || record.environment,
    providerMode: record.providerMode,
    l3EvidenceProofIds: evidence.l3EvidenceProofIds || record.l3EvidenceProofIds || [],
    l4EvidenceProofIds: evidence.l4EvidenceProofIds || record.l4EvidenceProofIds || [],
    scenariosRun: evidence.scenariosRun || [],
    scenariosPassed: evidence.scenariosPassed || [],
    restartOrReconnectEvidence:
      evidence.restartOrReconnectEvidence || record.restartOrReconnectEvidence,
    timeoutEvidence: evidence.timeoutEvidence || record.timeoutEvidence,
    retryEvidence: evidence.retryEvidence || record.retryEvidence,
    concurrencyEvidence: evidence.concurrencyEvidence || record.concurrencyEvidence,
    degradedModeEvidence: evidence.degradedModeEvidence || record.degradedModeEvidence,
    recoveryEvidence: evidence.recoveryEvidence || record.recoveryEvidence,
    statePreservationEvidence:
      evidence.statePreservationEvidence || record.statePreservationEvidence,
    observabilityEvidence: evidence.observabilityEvidence || record.observabilityEvidence,
    conclusion: evidence.conclusion || "UNKNOWN",
    gaps,
  };
}

function resilienceRecordMatchesCapability(record, capability) {
  return (
    sameCapabilityName(record.resilienceEvidence?.capability, capability) ||
    (record.subjectIds || []).some((subject) => sameCapabilityName(subject, capability))
  );
}

function nextRecommendedL5Pilot(rows) {
  const remaining = rows
    .filter((row) => !row.l5aLocalResilienceProven)
    .find((row) => row.currentReadiness === "SUBSTRATE_PROVEN" && row.l4Pass === true);
  if (!remaining) return null;
  return {
    capability: remaining.capability,
    recommendedPhase: "compose-local resilience proof",
  };
}

function foundationGaps(record) {
  const gaps = [];
  if (resilienceGaps(record).length > 0) {
    gaps.push({
      kind: "l5-resilience-incomplete",
      message: "L6 Foundation Proven requires complete L5 Resilience Proven evidence first",
    });
  }
  const requirements = [
    ["tenantBoundaryAsserted", "missing-foundation-tenancy", "tenancy"],
    ["securityBoundaryAsserted", "missing-foundation-security", "security"],
    ["auditEventIds", "missing-foundation-audit", "audit"],
    ["traceIds", "missing-foundation-trace", "trace"],
    ["metricSamples", "missing-foundation-metric", "metric"],
    ["logCorrelationIds", "missing-foundation-log", "log"],
    ["cleanupResult", "missing-foundation-operational-recovery", "operational recovery"],
    ["sourceFileRefs", "missing-foundation-lifecycle-governance", "lifecycle governance"],
  ];
  for (const [field, kind, label] of requirements) {
    if (!isMeaningfulEvidence(record[field])) {
      gaps.push({ kind, message: `L6 Foundation Proven requires ${label} evidence` });
    }
  }
  return gaps;
}

function l6CorrelationComplete(record) {
  const env = record.environmentMode || record.environment;
  return (
    (env === "staging" || env === "e2e") &&
    isMeaningfulObject(record.beforeState) &&
    isMeaningfulObject(record.afterState) &&
    isMeaningfulObject(record.assertedStateDiff) &&
    record.sideEffectsAsserted === true &&
    record.failurePathExercised === true &&
    (record.routeIds || []).length > 0 &&
    (record.workflowIds || []).length > 0 &&
    (record.eventIds || []).length > 0 &&
    (record.auditEventIds || []).length > 0 &&
    (record.traceIds || []).length > 0 &&
    (record.metricSamples || []).length > 0 &&
    (record.logCorrelationIds || []).length > 0
  );
}

function recordsBySubject(records) {
  const bySubject = new Map();
  for (const record of records) {
    for (const subject of record.subjectIds || []) {
      if (!bySubject.has(subject)) bySubject.set(subject, []);
      bySubject.get(subject).push(record);
    }
  }
  return bySubject;
}

function hasMutationRouteStateEvidence(record, route) {
  if (!(record.routeIds || []).includes(route.routeId)) return false;
  return (
    routeStatePart(record.beforeState, route) &&
    routeStatePart(record.afterState, route) &&
    routeStatePart(record.assertedStateDiff, route)
  );
}

function routeStatePart(state, route) {
  if (!isMeaningfulObject(state)) return false;
  const routeMutations = state.routeMutations;
  if (isMeaningfulObject(routeMutations) && isMeaningfulEvidence(routeMutations[route.routeId])) {
    return true;
  }
  return isMeaningfulEvidence(state[route.routeId]);
}

function isBehaviourCandidate(record) {
  return (
    proofLevelNumber(record.proofLevelClaimed) >= 3 ||
    isMeaningfulObject(record.beforeState) ||
    isMeaningfulObject(record.afterState) ||
    isMeaningfulObject(record.assertedStateDiff) ||
    record.sideEffectsAsserted === true ||
    record.failurePathExercised === true ||
    record.tenantBoundaryAsserted === true ||
    record.securityBoundaryAsserted === true
  );
}

function isClassifiedAtLeast(record, level) {
  return (
    proofLevelNumber(record.proofLevelClaimed) >= level ||
    observedLevelFromEvidence(record) >= level
  );
}

function sourceEvidence(record) {
  const files = (record.sourceFileRefs || []).filter((ref) => fs.existsSync(ref));
  const text = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  const assertionCount = countMatches(
    text,
    /\bassert\.(?:equal|deepEqual|ok|match|rejects|doesNotReject|throws|doesNotThrow|notEqual|notDeepEqual)\b|\bassert\s*\(/g
  );
  const awaitCount = countMatches(text, /\bawait\b/g);
  const emitEvidenceCount = countMatches(text, /\bemitRuntimeProofEvidence\s*\(/g);
  const failurePatternCount = countMatches(
    text,
    /\bassert\.rejects\b|\binjectFailure\b|\bdeadLettered\b|\bfail(?:ed|ure)?\b|\bunavailable\b|\binvalid\b|\bnot_found\b|\bdenied\b|\bcancelled\b|\bROLLBACK\b/g
  );
  const domainOperationCount = countMatches(
    text,
    /\.(?:create|upsert|put|delete|publish|process|start|signal|charge|refund|index|record|register|increment|backup|restore|run|cancel|ensure|validate)\s*\(/g
  );
  const execWrapperCount = countMatches(text, /\bexec(?:File|Sync|FileSync)?\b|\bspawn\b/g);
  const importRuntimeProofCount = countMatches(
    text,
    /from\s+["'][^"']*runtime-proof[^"']*["']|import\s*\([^)]*runtime-proof[^)]*\)/g
  );
  const wrapperOnly =
    importRuntimeProofCount > 0 ||
    (execWrapperCount > 0 && assertionCount === 0 && domainOperationCount === 0);
  return {
    sourceFilesChecked: files,
    assertionCount,
    awaitCount,
    emitEvidenceCount,
    failurePatternCount,
    domainOperationCount,
    execWrapperCount,
    importedRuntimeProofCount: importRuntimeProofCount,
    wrapperOnly,
  };
}

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

function stateTransitionWouldFailOnRegression(record, source) {
  if (!isMeaningfulObject(record.beforeState)) return false;
  if (!isMeaningfulObject(record.afterState)) return false;
  if (!isMeaningfulObject(record.assertedStateDiff)) return false;
  if (source.assertionCount <= 0 && record.assertionsObserved !== true) return false;
  return stateChanged(record.beforeState, record.afterState) || source.domainOperationCount > 0;
}

function stateChanged(beforeState, afterState) {
  return canonicalJson(beforeState) !== canonicalJson(afterState);
}

function failureStateEvidence(record) {
  return /fail|error|invalid|unavailable|dead|denied|not_found|cancelled/i.test(
    canonicalJson({
      failureMode: record.failureMode,
      afterState: record.afterState,
      assertedStateDiff: record.assertedStateDiff,
      cleanupResult: record.cleanupResult,
    })
  );
}

function capabilityLookupForRecords(ctx, records) {
  const capabilities = ctx.foundation?.["environment-capability-matrix.json"]?.capabilities || [];
  const lookup = new Map(records.map((record) => [record.proofId, []]));
  const bySubject = recordsBySubject(records);
  for (const capability of capabilities) {
    const capabilityRecords = uniqRecords([
      ...recordsForRefs(bySubject, capability.dev?.requiredProofs || []),
      ...recordsForRefs(bySubject, capability.test?.requiredProofs || []),
      ...recordsForRefs(bySubject, capability.staging?.requiredProofs || []),
    ]);
    for (const record of capabilityRecords) {
      lookup.set(
        record.proofId,
        uniq([...(lookup.get(record.proofId) || []), capability.capability])
      );
    }
  }
  return lookup;
}

function substrateServicesForProviders(providers) {
  const services = [];
  for (const provider of providers) {
    const text = String(provider || "").toLowerCase();
    if (!text) continue;
    if (text.includes("postgres")) services.push("Postgres");
    if (text.includes("redis") || text.includes("rate-limit")) services.push("Redis");
    if (text.includes("s3") || text.includes("object-storage") || text.includes("minio")) {
      services.push("MinIO");
    }
    if (text.includes("openbao") || text.includes("secret")) services.push("OpenBao");
    if (text.includes("keycloak") || text.includes("idp") || text.includes("oidc")) {
      services.push("Keycloak");
    }
    if (text.includes("temporal") || text.includes("workflow")) services.push("Temporal");
    if (text.includes("windmill") || text.includes("automation")) services.push("Windmill");
    if (text.includes("smtp") || text.includes("email")) services.push("SMTP");
    if (text.includes("clamav") || text.includes("antivirus")) services.push("ClamAV");
    if (text.includes("lago") || text.includes("billing")) services.push("Lago");
  }
  return uniq(services.length > 0 ? services : providers);
}

function substrateMigrationEffort(substrates, implementations) {
  const weight = substrates.length + Math.ceil(implementations.length / 3);
  if (weight <= 2) return "small";
  if (weight <= 5) return "medium";
  return "large";
}

function delegatedRuntimeProofImports(record) {
  const out = [];
  for (const ref of record.sourceFileRefs || []) {
    if (!fs.existsSync(ref)) continue;
    const text = fs.readFileSync(ref, "utf8");
    const matches =
      text.match(
        /from\s+["'][^"']*runtime-proof[^"']*["']|import\s*\([^)]*runtime-proof[^)]*\)/g
      ) || [];
    out.push(...matches.map((match) => ({ sourceFileRef: ref, importRef: match })));
  }
  return out;
}

function behaviourInconsistencies(record, gaps) {
  const inconsistencies = [];
  if (record.proofLevelObserved === "L3" && gaps.length > 0) {
    inconsistencies.push({
      kind: "observed-l3-with-behaviour-gaps",
      message: "record reports L3 while behavioural gap analysis is incomplete",
    });
  }
  if (record.sideEffectsAsserted === true && !isMeaningfulObject(record.assertedStateDiff)) {
    inconsistencies.push({
      kind: "side-effects-without-state-diff",
      message: "side effects are asserted without an asserted state diff",
    });
  }
  if (record.failurePathExercised === true && !isMeaningfulEvidence(record.failureMode)) {
    inconsistencies.push({
      kind: "failure-path-without-failure-mode",
      message: "failure path is marked exercised without failure-mode evidence",
    });
  }
  return inconsistencies;
}

function behaviourGapSeverity(record, gaps, inconsistencies) {
  if (proofLevelNumber(record.proofLevelClaimed) >= 4 && gaps.length > 0) return "critical";
  if (proofLevelNumber(record.proofLevelClaimed) >= 3 && gaps.length > 0) return "high";
  if (inconsistencies.length > 0) return "medium";
  if (gaps.length > 0) return "medium";
  return "none";
}

function behaviourRemediationEffort(gaps, inconsistencies) {
  const count = gaps.length + inconsistencies.length;
  if (count === 0) return "none";
  if (count <= 2) return "small";
  if (count <= 5) return "medium";
  return "large";
}

function behaviourClosureAction(gaps, inconsistencies) {
  if (gaps.length === 0 && inconsistencies.length === 0) return "No action required.";
  const missing = [...gaps, ...inconsistencies].map((gap) => gap.kind).join(", ");
  return `Update the proof to emit runtime evidence for: ${missing}. Do not increase L4 classification until these L3 behavioural fields are complete.`;
}

function recordsForRefs(bySubject, refs) {
  return uniqRecords(refs.flatMap((ref) => bySubject.get(ref) || []));
}

function uniqRecords(records) {
  const seen = new Set();
  const out = [];
  for (const record of records) {
    const key = `${record.proofId}:${record.evidenceFile || record.subjectId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

function maxObserved(records, cap = 6) {
  return Math.min(
    cap,
    records.reduce((max, record) => Math.max(max, observedLevelFromEvidence(record)), 0)
  );
}

function capabilityReadinessState({
  discovery,
  executable,
  contract,
  behaviour,
  substrate,
  resilience,
  foundation,
}) {
  if (foundation >= 6) return "FOUNDATION_PROVEN";
  if (resilience >= 5) return "RESILIENCE_PROVEN";
  if (substrate >= 4) return "SUBSTRATE_PROVEN";
  if (behaviour >= 3) return "BEHAVIOUR_PROVEN";
  if (contract >= 2) return "CONTRACT_PROVEN";
  if (executable >= 1) return "EXECUTABLE_PROVEN";
  if (discovery >= 0) return "DISCOVERY_PROVEN";
  return "UNPROVEN";
}

function capabilityMissingLevels({ hasDiscovery, highestLevel, behaviourComplete }) {
  const missing = [];
  if (!hasDiscovery) missing.push("discovery-L0");
  if (highestLevel < 1) missing.push("executable-L1");
  if (highestLevel < 2) missing.push("contract-L2");
  if (!behaviourComplete) missing.push("behaviour-L3");
  return missing;
}

function capabilityFutureBlockedLevels({
  behaviourComplete,
  substrateProven,
  resilienceProven,
  foundationProven,
}) {
  const blocked = [];
  if (!behaviourComplete) blocked.push("substrate-L4-blocked-until-L3");
  if (!substrateProven) blocked.push("resilience-L5-blocked-until-L4");
  if (substrateProven && !resilienceProven) blocked.push("resilience-L5-evidence-missing");
  if (!resilienceProven) blocked.push("foundation-L6-blocked-until-L5");
  if (!foundationProven) blocked.push("foundation-not-yet-proven");
  return blocked;
}

function capabilityCurrentClosureTarget({
  behaviourComplete,
  substrateProven,
  resilienceProven,
  foundationProven,
}) {
  if (!behaviourComplete) return "L3 Behaviour Proven";
  if (!substrateProven) return "L4 Substrate Proven";
  if (!resilienceProven) return "L5 Resilience Planning";
  if (!foundationProven) return "L6 Foundation Proven";
  return "Foundation Proven";
}

function capabilityAdvancementBlockers({
  l0Proven,
  highestLevel,
  behaviourComplete,
  substrateProven,
  resilienceProven,
  foundationProven,
}) {
  if (!l0Proven) {
    return [
      { targetLevel: "L1", blockedBy: "L0", message: "L1 blocked by missing L0" },
      { targetLevel: "L2", blockedBy: "L0", message: "L2 blocked by missing L0" },
      { targetLevel: "L3", blockedBy: "L0", message: "L3 blocked by missing L0" },
      { targetLevel: "L4", blockedBy: "L0", message: "L4 blocked by missing L0" },
      { targetLevel: "L5", blockedBy: "L0", message: "L5 blocked by missing L0" },
      { targetLevel: "L6", blockedBy: "L0", message: "L6 blocked by missing L0" },
    ];
  }
  const blockers = [];
  if (highestLevel < 1) {
    blockers.push({ targetLevel: "L1", blockedBy: "L0", message: "L1 blocked by missing L0" });
  }
  if (highestLevel < 2) {
    blockers.push({ targetLevel: "L2", blockedBy: "L1", message: "L2 blocked by missing L1" });
  }
  if (!behaviourComplete) {
    blockers.push({ targetLevel: "L3", blockedBy: "L2", message: "L3 blocked by missing L2" });
  }
  if (!substrateProven) {
    blockers.push({ targetLevel: "L4", blockedBy: "L3", message: "L4 blocked by missing L3" });
  }
  if (!resilienceProven) {
    blockers.push(
      substrateProven
        ? {
            targetLevel: "L5",
            blockedBy: "resilience-evidence",
            message: "L5 blocked by missing resilience evidence",
          }
        : { targetLevel: "L5", blockedBy: "L4", message: "L5 blocked by missing L4" }
    );
  }
  if (!foundationProven) {
    blockers.push({ targetLevel: "L6", blockedBy: "L5", message: "L6 blocked by missing L5" });
  }
  return blockers;
}

function capabilityReadinessGaps(row) {
  return (row.missingRequiredLevels || row.missingRequiredBands || []).map((band) => ({
    kind: capabilityGapKind(band),
    capability: row.capability,
    readiness: row.readiness,
    missingBand: band,
    message: `${row.capability} is ${row.readiness}; missing ${band} runtime evidence`,
  }));
}

function capabilityGapKind(band) {
  const map = {
    "discovery-L0": "capability-discovery-proof-missing",
    "executable-L1": "capability-executable-proof-missing",
    "contract-L2": "capability-contract-proof-missing",
    "behaviour-L3": "capability-behaviour-proof-missing",
    "substrate-L4-blocked-until-L3": "capability-substrate-proof-blocked-by-l3",
    "resilience-L5-blocked-until-L4": "capability-resilience-proof-blocked-by-l4",
    "foundation-L6-blocked-until-L5": "capability-foundation-proof-blocked-by-l5",
  };
  return map[band] || "capability-proof-band-missing";
}

function isStaticOrHermeticProvider(provider) {
  return [
    "static-assurance-provider",
    "openapi-drift-validator",
    "react-i18n-provider",
    "playwright-adapter",
    "playwright-axe-adapter",
  ].includes(provider);
}

function isMeaningfulObject(value) {
  return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
}

function isMeaningfulEvidence(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value === true) return true;
  if (typeof value === "string") return value.length > 0;
  return isMeaningfulObject(value);
}

function countBy(values, selector) {
  return values.reduce((acc, value) => {
    const key = selector(value);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function uniq(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function ownershipByCapability(ctx) {
  const ownershipReportPath = path.join(
    ctx.repoRoot || process.cwd(),
    "docs/v2-foundation/usf-audit/ownership-assurance-report.json"
  );
  const fromCtx = ctx.usfAudit?.["ownership-assurance-report.json"]?.capabilities || [];
  const fromDisk =
    fromCtx.length > 0 || !fs.existsSync(ownershipReportPath)
      ? []
      : JSON.parse(fs.readFileSync(ownershipReportPath, "utf8")).capabilities || [];
  const rows = fromCtx.length > 0 ? fromCtx : fromDisk;
  return new Map(
    rows.map((row) => [
      row.capability,
      row.runtimeOwner || row.ownerId || row.operationalOwner || row.ownerArtefact || null,
    ])
  );
}

function l0GapMessage(kind, capability) {
  const messages = {
    "missing-in-memory-implementation": `${capability} is missing an in-memory semantic-dev implementation`,
    "missing-owner": `${capability} is missing an owner definition`,
    "missing-category": `${capability} is missing a category definition`,
    "missing-dependencies": `${capability} is missing dependency definitions`,
    "missing-port-provider": `${capability} is missing an intended port/provider definition`,
    "missing-proof-command": `${capability} is missing a registered/discoverable proof command`,
    "invalid-l0-exception": `${capability} has an invalid L0 exception declaration`,
  };
  return messages[kind] || `${capability} has an L0 Discovery Proven gap: ${kind}`;
}
