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
  const behaviourReadiness = buildBehaviourProofReadinessReport(
    ctx,
    evidence.records,
    behaviourQuality
  );
  const capabilityReadiness = buildCapabilityProofReadinessReport(ctx, evidence.records);
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
    negativeControls,
  });
  const formalReadiness = buildFormalProofReadinessReport({
    evidence,
    strengthMatrix,
    claimVsObserved,
    ladderCompliance,
    environmentConsistency,
    ladderMigration,
    behaviourQuality,
    behaviourLocking,
    behaviourReadiness,
    behaviourCertification,
    substrateRoadmap,
    capabilityReadiness,
    inMemoryParity,
    routeSubjectMap,
    weakProofBacklog,
    negativeControls,
    formalGapTaxonomy,
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
    behaviourQuality,
    behaviourLocking,
    behaviourReadiness,
    behaviourCertification,
    substrateRoadmap,
    capabilityReadiness,
    inMemoryParity,
    routeSubjectMap,
    weakProofBacklog,
    negativeControls,
    formalGapTaxonomy,
    formalReadiness,
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
  if (ctx?.headCommit && record.commit !== ctx.headCommit) {
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
    hasBehaviour &&
    env === "staging" &&
    (record.providerMode === "external-sandbox" ||
      record.providerMode === "sandbox-external" ||
      record.providerMode === "prod-shaped-sandbox") &&
    record.externalSandboxProviderUsed === true &&
    (record.externalSandboxRequestIds || []).length > 0 &&
    resilienceGaps(record).length === 0;
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
  if (claimed > model.maxLevel && !stagingCompleteJourneyClaim) {
    gaps.push({
      kind: "environment-level-forbidden",
      subject: record.subjectId,
      message: `${env.toUpperCase()} proof cannot claim ${proofLevelId(claimed)}`,
    });
  }
  if (observed > model.maxLevel && !stagingCompleteJourneyObserved) {
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
  const sourceExecutesBehaviour = source.awaitCount > 0 || source.domainOperationCount > 0;
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

function buildBehaviourProofReadinessReport(ctx, records, behaviourQuality = null) {
  const capabilities = ctx.foundation?.["environment-capability-matrix.json"]?.capabilities || [];
  const bySubject = recordsBySubject(records);
  const qualityByProofId = new Map(
    (behaviourQuality?.proofs || []).map((proof) => [proof.proofId, proof])
  );
  const rows = capabilities.map((capability) => {
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
      incomplete.flatMap((record) => {
        const quality = qualityByProofId.get(record.proofId);
        return quality ? quality.blockingIssues : behaviourGaps(record).map((gap) => gap.kind);
      })
    );
    return {
      capability: capability.capability,
      category: capability.category,
      l3CandidateProofs: candidates.length,
      completeL3Proofs: complete.length,
      incompleteL3Proofs: incomplete.length,
      behaviourProven: candidates.length > 0 && incomplete.length === 0,
      eligibleForSubstrateProvenWork: candidates.length > 0 && incomplete.length === 0,
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
      behaviourCertified: behaviourCertification.status === "PASS" && existingL3Proofs.length > 0,
      requiredComposeSubstrates,
      requiredRealImplementations: realImplementations,
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
      migrationEffort: substrateMigrationEffort(requiredComposeSubstrates, realImplementations),
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

export function buildCapabilityProofReadinessReport(ctx, records) {
  const capabilities = ctx.foundation?.["environment-capability-matrix.json"]?.capabilities || [];
  const bySubject = recordsBySubject(records);
  const rows = capabilities.map((capability) => {
    const devRecords = recordsForRefs(bySubject, capability.dev?.requiredProofs || []);
    const testRecords = recordsForRefs(bySubject, capability.test?.requiredProofs || []);
    const stagingRecords = recordsForRefs(bySubject, capability.staging?.requiredProofs || []);
    const allCapabilityRecords = uniqRecords([...devRecords, ...testRecords, ...stagingRecords]);
    const highestLevel = maxObserved(allCapabilityRecords);
    const behaviourCandidates = allCapabilityRecords.filter((record) =>
      isBehaviourCandidate(record)
    );
    const behaviourComplete =
      behaviourCandidates.length > 0 &&
      behaviourCandidates.every((record) => behaviourGaps(record).length === 0);
    const substrateEligible = behaviourComplete;
    const substrateProven = allCapabilityRecords.some(
      (record) => observedLevelFromEvidence(record) >= 4
    );
    const resilienceProven = allCapabilityRecords.some(
      (record) => observedLevelFromEvidence(record) >= 5
    );
    const foundationProven = allCapabilityRecords.some(
      (record) => observedLevelFromEvidence(record) >= 6
    );
    const readiness = capabilityReadinessState({
      discovery: allCapabilityRecords.length > 0 ? 0 : -1,
      executable: highestLevel >= 1 ? 1 : 0,
      contract: highestLevel >= 2 ? 2 : 0,
      behaviour: behaviourComplete ? 3 : Math.min(highestLevel, 2),
      substrate: substrateProven ? 4 : 0,
      resilience: resilienceProven ? 5 : 0,
      foundation: foundationProven ? 6 : 0,
    });
    const missingRequiredLevels = capabilityMissingLevels({
      hasDiscovery: allCapabilityRecords.length > 0,
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
      currentClosureTarget: "L3 Behaviour Proven",
      highestDiscoveryLevelAchieved: allCapabilityRecords.length > 0 ? "L0" : "NONE",
      highestExecutableLevelAchieved: highestLevel >= 1 ? "L1" : "NONE",
      highestContractLevelAchieved: highestLevel >= 2 ? "L2" : "NONE",
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

function buildRouteProofSubjectMap(audit) {
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
  negativeControls,
}) {
  return [
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
  const requirements = [
    ["restartEvidence", "missing-restart-evidence", "restart evidence"],
    ["timeoutEvidence", "missing-timeout-evidence", "timeout evidence"],
    ["retryEvidence", "missing-retry-evidence", "retry evidence"],
    ["concurrencyEvidence", "missing-concurrency-evidence", "concurrency evidence"],
    ["recoveryEvidence", "missing-recovery-evidence", "recovery evidence"],
    ["backupRestoreEvidence", "missing-backup-restore-evidence", "backup/restore evidence"],
    ["degradedModeEvidence", "missing-degraded-mode-evidence", "degraded-mode evidence"],
    [
      "failureInjectionEvidence",
      "missing-failure-injection-evidence",
      "failure injection evidence",
    ],
  ];
  for (const [field, kind, label] of requirements) {
    if (!isMeaningfulEvidence(record[field])) {
      gaps.push({ kind, message: `L5 Resilience Proven requires ${label}` });
    }
  }
  return gaps;
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
  if (!resilienceProven) blocked.push("foundation-L6-blocked-until-L5");
  if (!foundationProven) blocked.push("foundation-not-yet-proven");
  return blocked;
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
