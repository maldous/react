#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import prettier from "prettier";
import { loadContext } from "../src/load.mjs";
import { buildAdversarialUSFAudit } from "../src/adversarial-usf-audit.mjs";
import {
  PROOF_EVIDENCE_DIR,
  buildRouteProofSubjectMap,
  requiredRuntimeProofs,
} from "../src/proof-evidence.mjs";

const repoRoot = process.cwd();
const ctx = loadContext({ repoRoot, strict: true });
const audit = buildAdversarialUSFAudit(ctx);
const outDir = path.join(repoRoot, PROOF_EVIDENCE_DIR);
const runId = `proof-run-${Date.now()}-${process.pid}`;
const runtimeHook = path.join(
  repoRoot,
  "tools/v2-readiness/scripts/proof-evidence-runtime-hook.mjs"
);
const timeoutMs = Number(process.env.USF_PROOF_COMMAND_TIMEOUT_MS || 120_000);
const limit = Number(process.env.USF_COLLECT_PROOF_LIMIT || 0);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const requiredProofs = dedupeProofExecutions(requiredRuntimeProofs(ctx, audit));
const routeSubjectMap = buildRouteProofSubjectMap(audit);
const routeIdsByProofFile = routeIdsByProof(requiredProofs, routeSubjectMap);
const selectedProofs = limit > 0 ? requiredProofs.slice(0, limit) : requiredProofs;
const collection = {
  artefact: "proof-evidence-collection-report",
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  collectorRunId: runId,
  currentCommit: ctx.headCommit,
  timeoutMs,
  requiredProofCount: requiredProofs.length,
  executedProofCount: selectedProofs.length,
  skippedByLimitCount: Math.max(0, requiredProofs.length - selectedProofs.length),
  evidenceDirectory: PROOF_EVIDENCE_DIR,
  executions: [],
};

let emitted = 0;
for (const proof of selectedProofs) {
  const evidencePath = path.join(outDir, `${safeName(proof.file)}.json`);
  const metadata = {
    proofId: proof.proofId,
    proofFile: proof.file,
    subjectIds: proof.subjectIds,
    capabilityId: capabilityIdFor(proof),
    providerId: providerIdFor(proof),
    proofLevelClaimed: proof.proofLevelClaimed,
    commandExecuted: proof.commandExecuted,
    routeIds: routeIdsByProofFile.get(proof.file) || proof.routeIds || [],
    currentCommit: ctx.headCommit,
    collectorRunId: runId,
    sourceFileRefs: proof.sourceFileRefs || [proof.file],
  };
  const mode = proofExecutionMode(proof);
  const env = {
    ...process.env,
    NODE_OPTIONS: appendNodeImport(process.env.NODE_OPTIONS, runtimeHook),
    USF_PROOF_EVIDENCE_FILE: evidencePath,
    USF_PROOF_EVIDENCE_METADATA: JSON.stringify(metadata),
    USF_PROOF_RUN_ID: runId,
    ENV: mode.environmentMode,
    USF_ENVIRONMENT_MODE: mode.environmentMode,
    USF_PROVIDER_MODE: mode.providerMode,
  };
  const startedAt = new Date().toISOString();
  const result = spawnSync(proof.commandExecuted, {
    cwd: repoRoot,
    env,
    shell: true,
    timeout: timeoutMs,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const endedAt = new Date().toISOString();
  const evidenceEmitted = fs.existsSync(evidencePath);
  if (evidenceEmitted) emitted++;
  collection.executions.push({
    proofId: proof.proofId,
    proofFile: proof.file,
    commandExecuted: proof.commandExecuted,
    startedAt,
    endedAt,
    exitStatus: typeof result.status === "number" ? result.status : null,
    signal: result.signal || null,
    timedOut: result.error?.code === "ETIMEDOUT",
    evidenceEmitted,
    evidenceFile: evidenceEmitted ? path.relative(repoRoot, evidencePath) : null,
    stderrTail: tail(result.stderr || ""),
  });
}

const collectionPath = path.join(outDir, "_collection-report.json");
fs.writeFileSync(collectionPath, await formatJson(collection, collectionPath));

console.log(
  `proof evidence collected: ${emitted} emitted records from ${selectedProofs.length} executed proof command(s) -> ${PROOF_EVIDENCE_DIR}`
);

function dedupeProofExecutions(proofs) {
  const byFile = new Map();
  for (const proof of proofs) {
    if (!byFile.has(proof.file)) byFile.set(proof.file, proof);
  }
  return [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));
}

function routeIdsByProof(proofs, routeSubjectMap) {
  const routeIdsBySubject = new Map();
  for (const route of routeSubjectMap.routes || []) {
    if (!route.mutationBeforeAfterRequired) continue;
    for (const ref of route.proofRefs || []) {
      if (!routeIdsBySubject.has(ref)) routeIdsBySubject.set(ref, new Set());
      routeIdsBySubject.get(ref).add(route.routeId);
    }
  }
  const out = new Map();
  for (const proof of proofs) {
    const ids = new Set(proof.routeIds || []);
    for (const subject of proof.subjectIds || []) {
      for (const routeId of routeIdsBySubject.get(subject) || []) ids.add(routeId);
    }
    out.set(proof.file, [...ids].sort());
  }
  return out;
}

function appendNodeImport(current, hookPath) {
  const hookUrl = pathToFileURL(hookPath).href;
  const existing = current ? `${current} ` : "";
  return `${existing}--import ${JSON.stringify(hookUrl)}`;
}

function safeName(value) {
  return String(value)
    .replace(/\.[cm]?[jt]sx?$/i, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function capabilityIdFor(proof) {
  const refs = proof.subjectIds.filter((subject) => subject.startsWith("proof:"));
  return refs.length
    ? refs.map((ref) => ref.replace(/^proof:/, "capability:")).join(",")
    : "unknown";
}

function providerIdFor(proof) {
  const base = path.basename(proof.file, path.extname(proof.file)).replace(/-runtime-proof$/, "");
  return /provider|adapter|repository|store|bus|storage|workflow|billing|notification|webhook|search|secret|rate-limit|antivirus/i.test(
    base
  )
    ? base
    : "not-applicable";
}

function proofExecutionMode(proof) {
  if (proof.file.includes("/in-memory-")) {
    return { environmentMode: "dev", providerMode: "semantic-dev" };
  }
  if (proof.file.includes("tools/ui-reference-harness/playwright/")) {
    return { environmentMode: "test", providerMode: "route-contract" };
  }
  if (proof.file.includes("route-contracts-runtime-proof")) {
    return { environmentMode: "test", providerMode: "route-contract" };
  }
  if (
    proof.file.includes("l5-postgres-tenant-identity-resilience-runtime-proof") ||
    proof.file.includes("l5-identity-access-resilience-runtime-proof")
  ) {
    return { environmentMode: "test", providerMode: "compose-local" };
  }
  if (proof.proofLevelClaimed === "L5" || proof.proofLevelClaimed === "L6") {
    return { environmentMode: "staging", providerMode: "external-sandbox" };
  }
  return { environmentMode: "test", providerMode: "compose-local" };
}

function tail(value) {
  const text = String(value);
  return text.length > 4000 ? text.slice(-4000) : text;
}

async function formatJson(value, filepath) {
  const config = (await prettier.resolveConfig(filepath)) || {};
  return prettier.format(JSON.stringify(value), { ...config, filepath, parser: "json" });
}
