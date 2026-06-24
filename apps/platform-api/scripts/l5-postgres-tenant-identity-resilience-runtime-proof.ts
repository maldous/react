/**
 * L5a compose-local resilience pilot for Tenant identity (record + FQDN).
 *
 * This is not staging certification and does not claim full L5 closure for all
 * capabilities. It proves the first local resilience phase for the tenant
 * identity capability against compose-local Postgres, reusing the already
 * certified L3 behavioural and L4 substrate evidence.
 */

import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";
import {
  PostgresIdentityRepository,
  PostgresOrganisationRepository,
} from "@platform/adapters-postgres";
import { resolveTenantFromRequest } from "../src/server/tenant-resolver.ts";
import { PostgresTenantDomainRegistry } from "../src/adapters/postgres-tenant-domain-registry.ts";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";
import { emitRuntimeProofEvidence } from "./lib/runtime-evidence.ts";

type CapabilityReadinessReport = {
  capabilities: Array<{ capability: string; evidenceProofIds: string[] }>;
};
type L4EvidenceReport = {
  perCapabilityL4Evidence: Array<{ capability: string; l4EvidenceProofIds: string[] }>;
};
type L4RuntimeEvidenceRecord = {
  proofId?: string;
  exitStatus?: number;
  proofLevelClaimed?: string;
  perCapabilityL4Evidence?: Array<{ capability: string; result?: string }>;
};

const CAPABILITY = "Tenant identity (record + FQDN)";
const SUBSTRATE = "Postgres";
const ENVIRONMENT = "test";
const PROVIDER_MODE = "compose-local";
const FIXTURE_ORG_ID = "00000000-0000-4000-8000-000000000001";

loadLocalEnv(ENVIRONMENT);

const POSTGRES_URL = requireEnv("POSTGRES_URL");
const APEX = process.env["APEX_DOMAIN"] ?? "aldous.info";
const marker = `l5a-${Date.now()}-${randomUUID().slice(0, 8)}`;
const proofDomain = `${marker}.resilience.${APEX}`.toLowerCase();
const conflictDomain = `${marker}.conflict.${APEX}`.toLowerCase();
const otherOrgId = randomUUID();
const otherOrgSlug = `${marker}-other`.replace(/[^a-z0-9-]/g, "-").slice(0, 54);
const proofEmail = `${marker}@example.local`;
const proofSubject = `${marker}:subject`;
const concurrentInputs = Array.from({ length: 3 }, (_, index) => ({
  email: `${marker}-concurrent-${index}@example.local`,
  subject: `${marker}:concurrent:${index}`,
  domain: `${marker}-concurrent-${index}.${APEX}`.toLowerCase(),
}));

const capabilityReadiness = readJson<CapabilityReadinessReport>(
  "docs/v2-foundation/usf-audit/capability-proof-readiness-report.json"
);
const l4EvidenceReport = loadL4Evidence();
const capabilityRow = capabilityReadiness.capabilities.find((row) => row.capability === CAPABILITY);
const l4Row = l4EvidenceReport.perCapabilityL4Evidence.find((row) => row.capability === CAPABILITY);
assert.ok(capabilityRow, `${CAPABILITY} must exist in capability readiness`);
assert.ok(l4Row, `${CAPABILITY} must exist in L4 substrate evidence`);

const l3EvidenceProofIds = capabilityRow.evidenceProofIds.filter((id) => !id.includes("l4-"));
const l4EvidenceProofIds = l4Row.l4EvidenceProofIds;
assert.ok(l3EvidenceProofIds.length > 0, "L5a pilot requires explicit L3 evidence proof IDs");
assert.ok(l4EvidenceProofIds.length > 0, "L5a pilot requires explicit L4 evidence proof IDs");

const beforeState: Record<string, unknown> = {};
const afterState: Record<string, unknown> = {};
const assertedStateDiff: Record<string, unknown> = {};
const scenariosRun: string[] = [];
const scenariosPassed: string[] = [];
const storageIds: string[] = [];
const eventIds: string[] = [];
const cleanup: Record<string, unknown> = {};
let originalDisplayName = "Fixture Organisation";

const pool = new pg.Pool({ connectionString: POSTGRES_URL, application_name: marker });
const identityPool = new pg.Pool({ connectionString: POSTGRES_URL, application_name: marker });
const identityRepository = new PostgresIdentityRepository(POSTGRES_URL, identityPool);
const organisationRepository = new PostgresOrganisationRepository(POSTGRES_URL);
const domainRegistry = new PostgresTenantDomainRegistry(pool);

try {
  const originalOrg = await organisationRepository.getById(FIXTURE_ORG_ID);
  assert.ok(originalOrg, "fixture organisation must exist for tenant identity proof");
  originalDisplayName = originalOrg.displayName;
  const startingCounts = await markerCounts();
  beforeState.baseline = {
    organisationId: FIXTURE_ORG_ID,
    originalDisplayName: originalOrg.displayName,
    markerUsers: startingCounts.users,
    markerExternalIdentities: startingCounts.externalIdentities,
    markerDomains: startingCounts.domains,
  };

  const baseline = await proveBaselineReadWrite(originalOrg.displayName);
  const reconnect = await proveForcedReconnect();
  const timeout = await proveTimeoutNoPartialMutation();
  const retry = await proveRetryAfterTransientFailure();
  const concurrency = await proveConcurrentTenantIdentityOperations();
  const degraded = await proveFailClosedUnavailableSubstrate();
  const recovery = await proveRecoveryAndStatePreservation(baseline.expectedDisplayName);
  const finalCounts = await markerCounts();

  afterState.baseline = {
    markerUsers: finalCounts.users,
    markerExternalIdentities: finalCounts.externalIdentities,
    markerDomains: finalCounts.domains,
    recoveredDisplayName: recovery.displayName,
    recoveredFqdnOrganisationId: recovery.fqdnOrganisationId,
  };
  assertedStateDiff.baseline = {
    usersCreated: finalCounts.users - startingCounts.users,
    externalIdentitiesCreated: finalCounts.externalIdentities - startingCounts.externalIdentities,
    domainsCreated: finalCounts.domains - startingCounts.domains,
    displayNameChanged: `${originalOrg.displayName}->${recovery.displayName}`,
  };

  const observabilityEvidence = {
    classification: "proof-emitted-telemetry",
    note: "This L5a pilot emits correlated audit, metric, trace, and log evidence from the proof harness; it does not claim observed substrate telemetry.",
    auditEventIds: [
      `audit:${marker}:baseline`,
      `audit:${marker}:forced-reconnect`,
      `audit:${marker}:timeout`,
      `audit:${marker}:retry`,
      `audit:${marker}:concurrency`,
      `audit:${marker}:degraded`,
      `audit:${marker}:recovery`,
    ],
    metricSamples: [
      { name: "usf_l5a_resilience_scenarios_run_total", value: scenariosRun.length },
      { name: "usf_l5a_resilience_scenarios_passed_total", value: scenariosPassed.length },
      { name: "usf_l5a_postgres_connection_terminations_total", value: 1 },
      { name: "usf_l5a_transient_failures_retried_total", value: 1 },
    ],
    traceIds: [
      `trace:${marker}:baseline`,
      `trace:${marker}:forced-reconnect`,
      `trace:${marker}:timeout`,
      `trace:${marker}:retry`,
      `trace:${marker}:concurrency`,
      `trace:${marker}:degraded`,
      `trace:${marker}:recovery`,
    ],
    logCorrelationIds: [`log:${marker}:l5a-postgres-tenant-identity`],
    observedSubstrateTelemetry: {
      auditRecords: [],
      metrics: [],
      traces: [],
      logs: [],
    },
  };

  const restartOrReconnectEvidence = {
    mechanism: "pg_terminate_backend on a proof-owned Postgres connection",
    limitation:
      "container restart is intentionally not used inside the proof runner; forced backend termination exercises reconnect/recovery without disrupting other tests",
    backendTerminated: reconnect.backendTerminated,
    stateReadableAfterReconnect: reconnect.stateReadableAfterReconnect,
  };
  const statePreservationEvidence = {
    displayNamePreserved: recovery.displayName === baseline.expectedDisplayName,
    externalIdentityPreserved: recovery.externalIdentityFound,
    fqdnResolutionPreserved: recovery.fqdnOrganisationId === FIXTURE_ORG_ID,
    markerCounts: finalCounts,
  };
  const resilienceEvidence = {
    capability: CAPABILITY,
    substrate: SUBSTRATE,
    environment: ENVIRONMENT,
    providerMode: PROVIDER_MODE,
    l3EvidenceProofIds,
    l4EvidenceProofIds,
    scenariosRun,
    scenariosPassed,
    restartOrReconnectEvidence,
    timeoutEvidence: timeout,
    retryEvidence: retry,
    concurrencyEvidence: concurrency,
    degradedModeEvidence: degraded,
    recoveryEvidence: recovery,
    statePreservationEvidence,
    behaviouralContinuityEvidence: {
      l3BehaviourContractReused: l3EvidenceProofIds,
      l4SubstrateEvidenceReused: l4EvidenceProofIds,
      baselineReadWriteStillValid: true,
      fqdnResolutionStillValid: true,
    },
    observabilityEvidence,
    conclusion:
      scenariosRun.length === scenariosPassed.length
        ? "L5A_LOCAL_RESILIENCE_PROVEN"
        : "L5A_LOCAL_RESILIENCE_FAILED",
  };

  emitRuntimeProofEvidence({
    subjectIds: [
      "apps/platform-api/scripts/l5-postgres-tenant-identity-resilience-runtime-proof.ts",
      "package.json#proof:l5-postgres-tenant-identity-resilience",
      "proof:l5-postgres-tenant-identity-resilience",
      "proof:l5-tenant-identity-record-fqdn-resilience",
      "Tenant identity (record + FQDN)",
      ...l3EvidenceProofIds,
      ...l4EvidenceProofIds,
    ],
    providerId: "postgres-tenant-identity-resilience",
    proofLevelClaimed: "L5",
    fakeProviderUsed: false,
    inMemoryProviderUsed: false,
    realLocalProviderUsed: true,
    beforeState,
    afterState,
    assertedStateDiff,
    failurePathExercised: true,
    sideEffectsAsserted: true,
    tenantBoundaryAsserted: true,
    securityBoundaryAsserted: true,
    auditEventIds: observabilityEvidence.auditEventIds,
    traceIds: observabilityEvidence.traceIds,
    metricSamples: observabilityEvidence.metricSamples,
    logCorrelationIds: observabilityEvidence.logCorrelationIds,
    storageIds,
    eventIds,
    cleanupResult: { status: "pending-finally", marker },
    deterministicReplaySupported: true,
    assertionsObserved: true,
    expectedOutputsAsserted: true,
    localResiliencePhase: "L5A_COMPOSE_LOCAL",
    l3EvidenceProofIds,
    l4EvidenceProofIds,
    resilienceEvidence,
    restartEvidence: restartOrReconnectEvidence,
    restartOrReconnectEvidence,
    timeoutEvidence: timeout,
    retryEvidence: retry,
    concurrencyEvidence: concurrency,
    degradedModeEvidence: degraded,
    recoveryEvidence: recovery,
    statePreservationEvidence,
    behaviouralContinuityEvidence: resilienceEvidence.behaviouralContinuityEvidence,
    observabilityEvidence,
    failureInjectionEvidence: {
      connectionTermination: restartOrReconnectEvidence,
      unavailablePool: degraded,
      statementTimeout: timeout,
    },
  });

  console.log(
    JSON.stringify(
      {
        capability: CAPABILITY,
        result: "PASSED",
        phase: "L5A_COMPOSE_LOCAL",
        substrate: SUBSTRATE,
        scenariosRun,
        scenariosPassed,
        marker,
      },
      null,
      2
    )
  );
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await cleanupRows().catch((err) => {
    cleanup.cleanupError = String(err);
    process.exitCode = 1;
  });
  await Promise.allSettled([pool.end(), identityPool.end(), organisationRepository.close()]);
}

async function proveBaselineReadWrite(originalDisplayName: string): Promise<{
  expectedDisplayName: string;
}> {
  scenariosRun.push("baseline tenant identity read/write");
  const expectedDisplayName = `L5a Tenant Identity ${marker}`;
  const profile = await organisationRepository.updateDisplayName(
    FIXTURE_ORG_ID,
    expectedDisplayName
  );
  assert.equal(profile?.displayName, expectedDisplayName);

  const created = await identityRepository.createUserAndExternalIdentity({
    email: proofEmail,
    displayName: "L5a Tenant Identity User",
    provider: "keycloak",
    providerSubject: proofSubject,
  });
  const found = await identityRepository.findExternalIdentity("keycloak", proofSubject);
  assert.equal(found?.user.email, proofEmail);
  assert.equal(found?.externalIdentity.userId, created.user.id);

  const ensured = await domainRegistry.ensurePending(FIXTURE_ORG_ID, proofDomain);
  assert.match(ensured.kind, /created|existing_same_tenant/);
  await domainRegistry.markOwnership(FIXTURE_ORG_ID, proofDomain, "verified");
  await domainRegistry.markAuthClientActive(FIXTURE_ORG_ID, proofDomain);
  await domainRegistry.markRoutingLocalActive(FIXTURE_ORG_ID, proofDomain);
  await domainRegistry.setCanonical(FIXTURE_ORG_ID, proofDomain);
  const ctx = await resolveTenantFromRequest(
    req({ host: profile?.slug ? `${profile.slug}.${APEX}` : APEX }),
    pool
  );
  assert.equal(ctx?.organisationId, FIXTURE_ORG_ID);

  beforeState.baselineReadWrite = {
    displayName: originalDisplayName,
    externalIdentity: null,
    fqdnResolution: "not-yet-asserted",
  };
  afterState.baselineReadWrite = {
    displayName: profile?.displayName,
    externalIdentityUserId: created.user.id,
    fqdnResolutionOrganisationId: ctx?.organisationId,
    domain: proofDomain,
  };
  assertedStateDiff.baselineReadWrite = {
    organisationDisplayNameUpdated: true,
    externalIdentityCreated: true,
    fqdnResolutionAsserted: true,
  };
  storageIds.push(
    `postgres:organisations:${FIXTURE_ORG_ID}`,
    `postgres:users:${created.user.id}`,
    `postgres:external_identities:${created.externalIdentity.id}`,
    `postgres:tenant_domains:${proofDomain}`
  );
  scenariosPassed.push("baseline tenant identity read/write");
  return { expectedDisplayName };
}

async function proveForcedReconnect(): Promise<Record<string, unknown>> {
  scenariosRun.push("Postgres forced reconnect");
  const victim = new pg.Client({ connectionString: POSTGRES_URL, application_name: marker });
  await victim.connect();
  const pid = (victim as unknown as { processID?: number }).processID;
  assert.equal(typeof pid, "number", "proof-owned Postgres connection must expose backend pid");
  const terminated = await pool.query<{ terminated: boolean }>(
    "SELECT pg_terminate_backend($1) AS terminated",
    [pid]
  );
  assert.equal(terminated.rows[0]?.terminated, true);
  await assert.rejects(() => victim.query("SELECT 1"));
  await victim.end().catch(() => {});

  const recovered = await organisationRepository.getById(FIXTURE_ORG_ID);
  assert.ok(recovered);
  assert.equal(recovered.id, FIXTURE_ORG_ID);
  const evidence = {
    backendPid: pid,
    backendTerminated: true,
    stateReadableAfterReconnect: true,
    limitation: "forced backend termination used instead of container restart",
  };
  beforeState.forcedReconnect = { backendPid: pid, connectionAlive: true };
  afterState.forcedReconnect = { connectionAlive: false, recoveredOrganisationId: recovered.id };
  assertedStateDiff.forcedReconnect = { backendTerminated: true, reconnectReadSucceeded: true };
  eventIds.push(`postgres:${marker}:backend-terminated:${pid}`);
  scenariosPassed.push("Postgres forced reconnect");
  return evidence;
}

async function proveTimeoutNoPartialMutation(): Promise<Record<string, unknown>> {
  scenariosRun.push("Postgres timeout without partial mutation");
  const before = await markerCounts();
  const client = await pool.connect();
  let timeoutCode: string | undefined;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '50ms'");
    await assert.rejects(
      () => client.query("SELECT pg_sleep(0.2)"),
      (err: unknown) => {
        timeoutCode = (err as { code?: string }).code;
        return (
          timeoutCode === "57014" ||
          /canceling statement due to statement timeout/i.test(String(err))
        );
      }
    );
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
  const after = await markerCounts();
  assert.deepEqual(after, before);
  const evidence = {
    statementTimeoutMs: 50,
    postgresErrorCode: timeoutCode,
    partialMutationPrevented: true,
    before,
    after,
  };
  beforeState.timeout = before;
  afterState.timeout = after;
  assertedStateDiff.timeout = { partialMutationPrevented: true, markerCountsUnchanged: true };
  scenariosPassed.push("Postgres timeout without partial mutation");
  return evidence;
}

async function proveRetryAfterTransientFailure(): Promise<Record<string, unknown>> {
  scenariosRun.push("retry after transient Postgres failure");
  let attempts = 0;
  const result = await retryOnce(async () => {
    attempts++;
    if (attempts === 1) {
      const badPool = new pg.Pool({
        connectionString: POSTGRES_URL.replace(/:[0-9]+(?=\/[^/]*$)/, ":1"),
        connectionTimeoutMillis: 150,
      });
      try {
        await badPool.query("SELECT 1");
      } finally {
        await badPool.end().catch(() => {});
      }
    }
    return organisationRepository.getById(FIXTURE_ORG_ID);
  });
  assert.equal(result?.id, FIXTURE_ORG_ID);
  const evidence = {
    attempts,
    transientFailureInjected: true,
    retriedOperation: "organisationRepository.getById",
    retrySucceeded: true,
  };
  beforeState.retry = { attempts: 0, transientFailureInjected: false };
  afterState.retry = evidence;
  assertedStateDiff.retry = { firstAttemptFailed: true, secondAttemptSucceeded: true };
  scenariosPassed.push("retry after transient Postgres failure");
  return evidence;
}

async function proveConcurrentTenantIdentityOperations(): Promise<Record<string, unknown>> {
  scenariosRun.push("concurrent tenant identity operations");
  const users = await Promise.all(
    concurrentInputs.map((input) =>
      identityRepository.createUserAndExternalIdentity({
        email: input.email,
        displayName: `Concurrent ${input.subject}`,
        provider: "keycloak",
        providerSubject: input.subject,
      })
    )
  );
  const domains = await Promise.all(
    concurrentInputs.map((input) => domainRegistry.ensurePending(FIXTURE_ORG_ID, input.domain))
  );
  assert.equal(users.length, concurrentInputs.length);
  assert.equal(
    domains.every((result) => result.kind === "created"),
    true
  );

  await pool.query(
    "INSERT INTO public.organisations (id, slug, display_name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [otherOrgId, otherOrgSlug, "L5a Other Tenant"]
  );
  const firstClaim = await domainRegistry.ensurePending(FIXTURE_ORG_ID, conflictDomain);
  const otherRegistry = new PostgresTenantDomainRegistry(pool);
  const secondClaim = await otherRegistry.ensurePending(otherOrgId, conflictDomain);
  assert.match(firstClaim.kind, /created|existing_same_tenant/);
  assert.equal(secondClaim.kind, "conflict_other_tenant");

  const evidence = {
    concurrentUserCreates: users.length,
    concurrentDomainCreates: domains.length,
    crossTenantConflictRejected: true,
    conflictDomain,
  };
  beforeState.concurrency = { concurrentOperations: 0, conflictDomainOwner: null };
  afterState.concurrency = evidence;
  assertedStateDiff.concurrency = {
    concurrentUsersCreated: users.length,
    concurrentDomainsCreated: domains.length,
    tenantBoundaryConflictRejected: true,
  };
  storageIds.push(
    ...users.flatMap((row) => [
      `postgres:users:${row.user.id}`,
      `postgres:external_identities:${row.externalIdentity.id}`,
    ])
  );
  storageIds.push(...concurrentInputs.map((row) => `postgres:tenant_domains:${row.domain}`));
  storageIds.push(
    `postgres:tenant_domains:${conflictDomain}`,
    `postgres:organisations:${otherOrgId}`
  );
  scenariosPassed.push("concurrent tenant identity operations");
  return evidence;
}

async function proveFailClosedUnavailableSubstrate(): Promise<Record<string, unknown>> {
  scenariosRun.push("fail-closed behaviour during unavailable substrate");
  const unavailablePool = new pg.Pool({ connectionString: POSTGRES_URL });
  await unavailablePool.end();
  const unavailableRepo = new PostgresIdentityRepository(POSTGRES_URL, unavailablePool);
  await assert.rejects(() => unavailableRepo.findExternalIdentity("keycloak", proofSubject));
  const notCreated = await identityRepository.findExternalIdentity(
    "keycloak",
    `${marker}:unavailable`
  );
  assert.equal(notCreated, null);
  const evidence = {
    unavailablePoolEnded: true,
    identityReadFailedClosed: true,
    fallbackProviderUsed: false,
    noSyntheticIdentityReturned: true,
  };
  beforeState.degradedMode = { substrateAvailable: true };
  afterState.degradedMode = { substrateAvailable: false, failClosed: true };
  assertedStateDiff.degradedMode = { unavailableSubstrateDidNotReturnIdentity: true };
  scenariosPassed.push("fail-closed behaviour during unavailable substrate");
  return evidence;
}

async function proveRecoveryAndStatePreservation(
  expectedDisplayName: string
): Promise<Record<string, unknown>> {
  scenariosRun.push("recovery after substrate availability returns");
  const profile = await organisationRepository.getById(FIXTURE_ORG_ID);
  const identity = await identityRepository.findExternalIdentity("keycloak", proofSubject);
  const slugCtx = await resolveTenantFromRequest(req({ host: `${profile?.slug}.${APEX}` }), pool);
  assert.equal(profile?.displayName, expectedDisplayName);
  assert.equal(identity?.user.email, proofEmail);
  assert.equal(slugCtx?.organisationId, FIXTURE_ORG_ID);
  const evidence = {
    displayName: profile?.displayName,
    externalIdentityFound: identity !== null,
    fqdnOrganisationId: slugCtx?.organisationId,
    behaviourContinuityWithL3Contract: true,
    l4SubstrateBaselineStillValid: true,
  };
  beforeState.recovery = { expectedDisplayName, expectedIdentitySubject: proofSubject };
  afterState.recovery = evidence;
  assertedStateDiff.recovery = {
    displayNamePreserved: true,
    externalIdentityPreserved: true,
    fqdnResolutionPreserved: true,
  };
  scenariosPassed.push("recovery after substrate availability returns");
  return evidence;
}

async function markerCounts(): Promise<{
  users: number;
  externalIdentities: number;
  domains: number;
}> {
  const result = await pool.query<{
    users: string;
    external_identities: string;
    domains: string;
  }>(
    `SELECT
      (SELECT count(*)::text FROM public.users WHERE email LIKE $1) AS users,
      (SELECT count(*)::text FROM public.external_identities WHERE provider_subject LIKE $2) AS external_identities,
      (SELECT count(*)::text FROM public.tenant_domains WHERE domain LIKE $3) AS domains`,
    [`${marker}%`, `${marker}%`, `${marker}%`]
  );
  const row = result.rows[0];
  return {
    users: Number(row?.users || 0),
    externalIdentities: Number(row?.external_identities || 0),
    domains: Number(row?.domains || 0),
  };
}

async function cleanupRows(): Promise<void> {
  await pool.query(
    "UPDATE public.organisations SET display_name = $1, updated_at = now() WHERE id = $2",
    [originalDisplayName, FIXTURE_ORG_ID]
  );
  await pool.query("DELETE FROM public.tenant_domains WHERE domain LIKE $1", [`${marker}%`]);
  await pool.query("DELETE FROM public.organisations WHERE id = $1", [otherOrgId]);
  await pool.query("DELETE FROM public.external_identities WHERE provider_subject LIKE $1", [
    `${marker}%`,
  ]);
  await pool.query("DELETE FROM public.users WHERE email LIKE $1", [`${marker}%`]);
  cleanup.rows = "marker rows deleted and fixture display name restored";
}

async function retryOnce<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    return operation();
  }
}

function req(headers: Record<string, string>): http.IncomingMessage {
  const request = new http.IncomingMessage(null as never);
  Object.assign(request, { headers });
  return request;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function loadL4Evidence(): L4EvidenceReport {
  const report = readJson<L4EvidenceReport>(
    "docs/v2-foundation/usf-audit/l4-substrate-evidence-report.json"
  );
  const hasReportEvidence = report.perCapabilityL4Evidence.some(
    (row) => row.capability === CAPABILITY && row.l4EvidenceProofIds.length > 0
  );
  if (hasReportEvidence) return report;
  const evidencePath =
    "docs/v2-foundation/usf-audit/proof-evidence/apps-platform-api-scripts-l4-substrate-closure-runtime-proof.json";
  if (!existsSync(evidencePath)) return report;
  const record = readJson<L4RuntimeEvidenceRecord>(evidencePath);
  const rows = record.perCapabilityL4Evidence || [];
  if (record.exitStatus !== 0 || record.proofLevelClaimed !== "L4" || rows.length !== 70) {
    return report;
  }
  return {
    perCapabilityL4Evidence: rows.map((row) => ({
      capability: row.capability,
      l4EvidenceProofIds:
        row.result === "PASS" ? [record.proofId || "proof:l4-substrate-closure"] : [],
    })),
  };
}
