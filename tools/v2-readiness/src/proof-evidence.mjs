import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { stableId } from "./formal-assurance.mjs";

export const PROOF_LEVELS = [
  { level: 0, id: "L0", name: "declaration only" },
  { level: 1, id: "L1", name: "schema/contract shape" },
  { level: 2, id: "L2", name: "unit behaviour" },
  { level: 3, id: "L3", name: "state transition + side effects" },
  { level: 4, id: "L4", name: "local real substrate" },
  { level: 5, id: "L5", name: "external sandbox/provider" },
  { level: 6, id: "L6", name: "end-to-end journey" },
];

export const PROOF_EVIDENCE_DIR = "docs/v2-foundation/usf-audit/proof-evidence";

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
  "providerMode",
  "proofLevelClaimed",
  "commandExecuted",
  "startedAt",
  "endedAt",
  "exitStatus",
  "commit",
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
  "failurePathExercised",
  "sideEffectsAsserted",
  "tenantBoundaryAsserted",
  "securityBoundaryAsserted",
  "auditEventIds",
  "traceIds",
  "metricSamples",
  "logCorrelationIds",
  "cleanupResult",
  "deterministicReplaySupported",
  "skipped",
  "skipReason",
  "generatedAt",
  "sourceFileRefs",
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
  const inMemoryParity = buildInMemoryProviderParityReport(ctx, evidence.records);
  const weakProofBacklog = buildWeakProofBacklog(requiredProofs, evidence, claimVsObserved);
  const negativeControls = buildNegativeControlReport(ctx);
  const formalReadiness = buildFormalProofReadinessReport({
    evidence,
    strengthMatrix,
    claimVsObserved,
    inMemoryParity,
    routeSubjectMap,
    weakProofBacklog,
    negativeControls,
  });

  return {
    schema: proofEvidenceSchema(),
    requiredProofs,
    evidenceIndex: evidence,
    strengthMatrix,
    claimVsObserved,
    inMemoryParity,
    routeSubjectMap,
    weakProofBacklog,
    negativeControls,
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
    .filter(
      ([name, command]) =>
        name.startsWith("proof:") &&
        /apps\/platform-api\/scripts\/[^\s"'`]+\.ts/.test(String(command))
    )
    .map(([name, command]) => {
      const file = String(command).match(/apps\/platform-api\/scripts\/[^\s"'`]+\.ts/)?.[0];
      if (!file || existingFiles.has(file)) return null;
      return {
        proofId: stableId("proof", file),
        file,
        subjectIds: uniq([file, `package.json#${name}`, name]),
        commandExecuted: `npm run ${name}`,
        proofLevelClaimed: file.includes("in-memory-vs-real-parity-proof") ? "L3" : "L2",
        routeIds: [],
        sourceFileRefs: [file],
      };
    })
    .filter(Boolean);
  return [...fromAudit, ...fromPackageScripts].sort((a, b) => a.file.localeCompare(b.file));
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
      (file) => file.endsWith(".json") && !file.includes(`${path.sep}negative-controls${path.sep}`)
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
  return {
    ...record,
    subjectIds,
    subjectId: record.subjectId || subjectIds[0] || record.proofId || "unknown",
    routeIds: record.routeIds || [],
    workflowIds: record.workflowIds || [],
    eventIds: record.eventIds || [],
    storageIds: record.storageIds || [],
    auditEventIds: record.auditEventIds || [],
    traceIds: record.traceIds || [],
    metricSamples: record.metricSamples || [],
    logCorrelationIds: record.logCorrelationIds || [],
    externalSandboxRequestIds: record.externalSandboxRequestIds || [],
    sourceFileRefs: record.sourceFileRefs || [],
    proofLevelClaimed: proofLevelId(record.proofLevelClaimed),
    proofLevelObserved: proofLevelId(observedLevelFromEvidence(record)),
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
      const hasState = matching.some(
        (record) => isMeaningfulObject(record.beforeState) && isMeaningfulObject(record.afterState)
      );
      if (!hasState) {
        gaps.push({
          kind: "mutation-state-evidence",
          subject: `${route.method} ${route.path}`,
          message: "mutation proof lacks emitted before/after state evidence",
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
      message: "fake HTTP adapter proof cannot claim local-real-provider strength",
    });
  }
  if (proofLevelNumber(record.proofLevelClaimed) >= 3) {
    if (!isMeaningfulObject(record.beforeState) || !isMeaningfulObject(record.afterState)) {
      gaps.push({
        kind: "missing-before-after-state",
        subject: record.subjectId,
        message: "L3+ proof requires before and after state snapshots",
      });
    }
    if (!isMeaningfulObject(record.assertedStateDiff) || record.sideEffectsAsserted !== true) {
      gaps.push({
        kind: "missing-side-effect-evidence",
        subject: record.subjectId,
        message: "L3+ proof requires asserted state diff and side-effect assertion",
      });
    }
    if (record.failurePathExercised !== true) {
      gaps.push({
        kind: "missing-failure-path",
        subject: record.subjectId,
        message: "L3+ proof requires an exercised failure path",
      });
    }
  }
  if (proofLevelNumber(record.proofLevelClaimed) >= 4 && record.realLocalProviderUsed !== true) {
    gaps.push({
      kind: "missing-real-local-substrate",
      subject: record.subjectId,
      message: "L4 proof requires real local substrate evidence",
    });
  }
  if (
    proofLevelNumber(record.proofLevelClaimed) >= 5 &&
    (!record.externalSandboxProviderUsed || record.externalSandboxRequestIds.length === 0)
  ) {
    gaps.push({
      kind: "missing-external-sandbox-request",
      subject: record.subjectId,
      message: "L5 proof requires external sandbox request/response ids",
    });
  }
  if (proofLevelNumber(record.proofLevelClaimed) >= 6) {
    const missing =
      record.routeIds.length === 0 ||
      record.auditEventIds.length === 0 ||
      record.traceIds.length === 0 ||
      record.metricSamples.length === 0 ||
      record.logCorrelationIds.length === 0;
    if (missing) {
      gaps.push({
        kind: "missing-l6-correlation",
        subject: record.subjectId,
        message: "L6 proof requires correlated UI/API/state/audit/trace/metric/log evidence",
      });
    }
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
  const hasShape = Boolean(
    record.proofId && record.commandExecuted && record.startedAt && record.endedAt
  );
  const hasBehaviour = hasShape && record.exitStatus === 0;
  const hasState =
    isMeaningfulObject(record.beforeState) &&
    isMeaningfulObject(record.afterState) &&
    isMeaningfulObject(record.assertedStateDiff) &&
    record.sideEffectsAsserted === true &&
    record.failurePathExercised === true;
  const hasRealLocal =
    hasState && record.realLocalProviderUsed === true && record.fakeProviderUsed !== true;
  const hasSandbox =
    hasState &&
    record.externalSandboxProviderUsed === true &&
    (record.externalSandboxRequestIds || []).length > 0;
  const hasE2E =
    hasState &&
    record.fakeProviderUsed !== true &&
    (record.routeIds || []).length > 0 &&
    (record.auditEventIds || []).length > 0 &&
    (record.traceIds || []).length > 0 &&
    (record.metricSamples || []).length > 0 &&
    (record.logCorrelationIds || []).length > 0;
  if (hasE2E) return 6;
  if (hasSandbox) return 5;
  if (hasRealLocal) return 4;
  if (hasState) return 3;
  if (hasBehaviour) return 2;
  if (hasShape) return 1;
  return 0;
}

function buildStrengthMatrix(records) {
  const byObserved = Object.fromEntries(PROOF_LEVELS.map((level) => [level.id, 0]));
  const byClass = {};
  const rows = records.map((record) => {
    const observed = proofLevelId(observedLevelFromEvidence(record));
    const evidenceClass = providerEvidenceClass(record);
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
    status: "PASS",
    levels: PROOF_LEVELS,
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
    const semanticProofs = records.filter(
      (record) =>
        record.inMemoryProviderUsed === true &&
        (record.providerId === alias.provider || record.subjectIds.includes(alias.proof))
    );
    const parityProofs = parityRecords.filter(
      (record) =>
        record.providerId === alias.provider ||
        record.subjectIds.includes(alias.provider) ||
        record.subjectIds.includes(alias.proof)
    );
    return {
      provider: alias.provider,
      adapterFile: alias.adapterFile,
      proof: alias.proof,
      correspondingRealProvider: alias.realProvider || realProviderFor(alias.provider),
      samePortInterface: parityProofs.length > 0,
      sameSemanticOutcomes: semanticProofs.some((record) => observedLevelFromEvidence(record) >= 3),
      sameFailureSemantics: semanticProofs.some((record) => record.failurePathExercised === true),
      sameEventAuditObservabilityContract: semanticProofs.some((record) =>
        observabilityComplete(record)
      ),
      semanticDevProofMode: semanticProofs.every((record) => record.providerMode === "semantic-dev")
        ? "in-memory-provider-proof"
        : "missing",
      realProviderParityProofMode:
        parityProofs.length > 0 ? "port-contract-parity-proof" : "missing",
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

function buildWeakProofBacklog(requiredProofs, evidence, claimVsObserved) {
  const missing = evidence.gaps.filter((gap) =>
    ["missing-evidence", "stale-evidence", "proof-claim-overstated"].includes(gap.kind)
  );
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
    status: missing.length === 0 && claimVsObserved.mismatchCount === 0 ? "PASS" : "FAIL",
    requiredProofCount: requiredProofs.length,
    missingOrStaleCount: missing.length,
    overclaimCount: claimVsObserved.mismatchCount,
    missingOrStale: missing,
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
      id: "missing-audit-evidence",
      record: {
        ...base,
        proofId: "negative:missing-audit-evidence",
        proofLevelClaimed: "L6",
        auditEventIds: [],
      },
      expectedKinds: ["missing-l6-correlation"],
    },
    {
      id: "missing-trace-evidence",
      record: {
        ...base,
        proofId: "negative:missing-trace-evidence",
        proofLevelClaimed: "L6",
        traceIds: [],
      },
      expectedKinds: ["missing-l6-correlation"],
    },
    {
      id: "missing-before-after-state",
      record: { ...base, proofId: "negative:missing-before-after-state", beforeState: {} },
      expectedKinds: ["missing-before-after-state", "proof-claim-overstated"],
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
      expectedKinds: ["proof-claim-overstated", "missing-l6-correlation"],
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
  ];
  const results = controls.map((control) => {
    const record = normalizeEvidenceRecord(signRecord(control.record));
    const { gaps } = validateEvidenceSet({
      ctx,
      records: [record],
      requiredProofs: [],
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

function buildFormalProofReadinessReport({
  evidence,
  claimVsObserved,
  inMemoryParity,
  routeSubjectMap,
  weakProofBacklog,
  negativeControls,
}) {
  const gaps = [
    ...evidence.gaps,
    ...claimVsObserved.mismatches.map((mismatch) => ({
      kind: "proof-claim-overstated",
      subject: mismatch.subjectId,
      message: `claimed ${mismatch.proofLevelClaimed} exceeds observed ${mismatch.proofLevelObserved}`,
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
    ...negativeControls.failed.map((gap) => ({
      kind: "negative-control-not-caught",
      subject: gap.id,
      message: "proof evidence validator did not catch the deliberate failing fixture",
    })),
  ];
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
      weakProofBacklogStatus: weakProofBacklog.status,
      negativeControls: negativeControls.status,
    },
    gaps,
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
  };
}

export function signRecord(record) {
  const signed = { ...record };
  signed.evidenceSignature = evidenceSignature(signed);
  return signed;
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

function isMeaningfulObject(value) {
  return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
}

function uniq(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}
