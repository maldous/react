#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const foundationDir = path.join(repoRoot, "docs/v2-foundation");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(foundationDir, name), "utf8"));
const writeJson = (name, value) =>
  fs.writeFileSync(path.join(foundationDir, name), `${JSON.stringify(value, null, 2)}\n`);

const capabilities = readJson("v1-capability-closure.json").filter(
  (capability) => capability.status === "delivered-and-proven"
);
const capabilityNames = new Set(capabilities.map((capability) => capability.capability));
const proofInventory = readJson("v1-test-proof-inventory.json");

const words = (value) => String(value || "").toLowerCase();
const sourceRefs = (value) =>
  [...String(value || "").matchAll(/(?:apps|packages|tools|docs|scripts)\/[A-Za-z0-9_./-]+/g)]
    .map((match) => match[0].replace(/[),.;:]+$/, ""))
    .filter(Boolean);
const proofRefs = (capability) =>
  [
    ...String(capability.proof || capability.semanticCompleteness?.proof || "").matchAll(
      /proof:[A-Za-z0-9_. -]+/g
    ),
  ]
    .map((match) => match[0].trim().replace(/[.;,)]+$/, ""))
    .filter((proof, index, all) => proof !== "proof: " && all.indexOf(proof) === index);
const firstProof = (capability) => proofRefs(capability)[0] || "proof:semantic-completeness";
const evidenceRefs = (capability) => {
  const proofs = proofRefs(capability);
  if (proofs.length) return proofs;
  const refs = sourceRefs(capability.semanticCompleteness?.proof);
  if (refs.length) return refs;
  if (capability.proof) return [capability.proof];
  return [`semantic-evidence:${capabilitySlug(capability.capability)}`];
};
const capabilitySlug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

function providerClassFor(capability) {
  const text = words(
    `${capability.capability} ${capability.category} ${capability.adapter} ${capability.port} ${capability.contract} ${capability.semanticCompleteness?.readinessModel}`
  );
  if (
    /oidc|keycloak|brevo|lago|webhook|smtp|dns|tls|object storage|s3|redis|openbao|grafana|tempo|loki|prometheus|clickhouse/.test(
      text
    )
  )
    return "sandbox-external";
  if (
    /postgres|database|repository|migration|rls|storage|history|audit|billing|meter|tenant|data/.test(
      text
    )
  )
    return "compose-local";
  if (/ui|accessibility|i18n|openapi|quality|scanning|decision/.test(text)) return "hermetic";
  return "compose-local";
}

function dataClassFor(capability) {
  const text = words(`${capability.capability} ${capability.category} ${capability.contract}`);
  if (/secret|credential|token|key/.test(text)) return "secret";
  if (
    /pii|profile|user|member|tenant|billing|invoice|payment|audit|logs|storage|search|data/.test(
      text
    )
  )
    return "tenant-data";
  if (/metric|trace|log|observability|status|readiness/.test(text)) return "operational-telemetry";
  return "configuration";
}

function capabilitySourceRefs(capability) {
  const refs = [
    ...sourceRefs(JSON.stringify(capability.semanticCompleteness || {})),
    ...sourceRefs(capability.contract),
    ...sourceRefs(capability.evidence),
  ];
  if (capability.adapter) refs.push(`apps/platform-api/src/adapters/${capability.adapter}.ts`);
  return [...new Set(refs)].slice(0, 8);
}

function hasDatabase(capability) {
  return /postgres|database|repository|migration|rls|storage|tenant|billing|meter|audit|history|search|governance|retention/i.test(
    `${capability.capability} ${capability.adapter || ""} ${capability.port || ""} ${capability.semanticCompleteness?.stateModel || ""}`
  );
}

function isTenantData(capability) {
  return /tenant|organisation|user|member|profile|billing|invoice|payment|meter|audit|log|history|storage|search|pii|gdpr|legal hold|domain/i.test(
    `${capability.capability} ${capability.category} ${capability.contract || ""}`
  );
}

function isProviderBacked(capability) {
  return providerClassFor(capability) !== "hermetic";
}

function envEntry(capability, env) {
  const proofs = evidenceRefs(capability);
  const providerClass = providerClassFor(capability);
  const dataClass = dataClassFor(capability);
  const base = {
    provider:
      env === "dev"
        ? `local ${capability.port || capability.adapter || capability.category} provider for ${capability.capability}`
        : env === "test"
          ? `deterministic ${capability.port || capability.adapter || capability.category} proof provider`
          : env === "staging"
            ? `prod-shape ${capability.adapter || capability.port || capability.category} provider with sandbox externals`
            : `production ${capability.adapter || capability.port || capability.category} provider`,
    providerClass:
      env === "prod" && providerClass === "sandbox-external" ? "live-external" : providerClass,
    dataClass,
    tenantDataAllowed:
      env === "prod" ? isTenantData(capability) : env !== "dev" || dataClass !== "secret",
    mockPolicy:
      env === "dev"
        ? "mocks allowed only for discovery when this row names the substitute; semantic proofs prefer local composed providers"
        : env === "test"
          ? "mocks allowed only for fixed fixtures outside provider contract proofs; no paid or live-only provider may be required"
          : env === "staging"
            ? "mocks forbidden; sandbox external providers must exercise the same contract shape as prod"
            : "mocks forbidden",
    sandboxPolicy:
      env === "prod"
        ? "sandbox providers forbidden except read-only readiness metadata from prior staging evidence"
        : env === "staging"
          ? "sandbox external providers required for integrations while preserving prod topology"
          : "sandbox providers allowed when deterministic and declared in proof evidence",
    liveProviderPolicy:
      env === "prod"
        ? "live provider is used only for real tenant operation and current non-destructive health"
        : env === "staging"
          ? "prod-shape rehearsal may use sandbox live services; production tenant data is forbidden"
          : "paid/live-only providers are not required for automated proof",
    secretPolicy:
      env === "prod"
        ? "real secrets come from the production secret manager; never echo secret values into proofs or UI semantics"
        : env === "staging"
          ? "staging uses the real secret-manager pattern with sandbox credentials and rotation rehearsal"
          : "local/test secrets are fixture-scoped or generated and must not be reused in staging/prod",
    networkPolicy:
      env === "prod"
        ? "only approved production egress/ingress for this capability; tests cannot open destructive or fixture endpoints"
        : env === "staging"
          ? "production-shape routing with sandbox external egress and observability enabled"
          : "local network or compose network only; deterministic tests must run without unapproved internet egress",
    proofLevelRequired: env === "prod" ? 0 : env === "staging" ? 4 : env === "test" ? 3 : 2,
    requiredProofs:
      env === "prod"
        ? [
            `readiness:${capabilitySlug(capability.capability)}`,
            `smoke:${capabilitySlug(capability.capability)}:non-destructive`,
          ]
        : proofs,
    requiredSmokeChecks:
      env === "prod"
        ? [
            `current health/readiness for ${capability.capability}`,
            "synthetic non-destructive journey only",
          ]
        : [`${env} semantic proof for ${capability.capability}`],
    seedDataPolicy:
      env === "prod"
        ? "no seed or fixture data may be inserted into production"
        : env === "staging"
          ? "staging rehearsal data is synthetic, isolated, and disposable"
          : "fixed fixtures are allowed when the proof states the capability boundary being exercised",
    destructiveProofPolicy:
      env === "prod"
        ? "destructive proofs forbidden"
        : env === "staging"
          ? "destructive rehearsal only against isolated sandbox tenant data with rollback evidence"
          : "destructive checks allowed only against disposable local/test data",
    promotionGate:
      env === "prod"
        ? `prod promotion for ${capability.capability} requires completed staging gate plus current non-destructive smoke/readiness`
        : `${env} promotion for ${capability.capability} requires ${env} required proofs to pass`,
    rollbackGate:
      env === "prod"
        ? `rollback for ${capability.capability} must preserve tenant data and verify current health/readiness`
        : `${env} rollback for ${capability.capability} re-runs affected proofs and checks migration reversibility where applicable`,
    observabilityRequired: [
      `${capability.category}.${capabilitySlug(capability.capability)}.readiness`,
      `${capability.category}.${capabilitySlug(capability.capability)}.errors`,
    ],
    costRisk:
      providerClass === "live-external" || providerClass === "sandbox-external"
        ? "external provider calls can create spend; dev/test use fixed fixtures and staging uses sandbox quotas"
        : "bounded to local composed infrastructure and CI runtime",
    securityRisk:
      dataClass === "secret"
        ? "secret material must remain write-only and masked in logs, proofs, UI, and evidence"
        : isTenantData(capability)
          ? "tenant data access must preserve permission checks, RLS/tenant isolation, and audit evidence"
          : "configuration and operational state must not bypass capability permissions",
    externalDependencyRisk:
      providerClass === "hermetic"
        ? "none beyond repository code and deterministic test runtime"
        : `${capability.capability} depends on ${capability.adapter || capability.port || capability.category}; failures must fail closed or degrade explicitly`,
  };
  return {
    ...base,
    mocksAllowed: env === "dev" || env === "test",
    sandboxProvidersAllowed: env !== "prod",
    liveProvidersRequired: env === "prod" && providerClass !== "hermetic",
    paidLiveOnlyProvider: false,
    prodLikeProof: env === "staging" ? true : undefined,
    smokeReadinessChecksAllowed: env === "prod" ? true : undefined,
    destructiveProofsForbidden: env === "prod" ? true : undefined,
    destructiveProofProdSafe: env === "prod" ? false : undefined,
  };
}

function strengthenEnvironmentMatrix() {
  writeJson("environment-capability-matrix.json", {
    artefact: "environment-capability-matrix",
    version: 2,
    mandatoryFoundationAsset: true,
    rule: "Every delivered capability must state dev/test/staging/prod provider, data, proof, failure, promotion, rollback, observability, cost, security, and external dependency policy.",
    coverage: {
      source: "docs/v2-foundation/v1-capability-closure.json",
      deliveredCapabilities: capabilities.length,
      enforcedBy: "tools/v2-readiness/src/rules/r24-environment-semantics.mjs",
    },
    capabilities: capabilities.map((capability) => ({
      capability: capability.capability,
      category: capability.category,
      sourceFileRefs: capabilitySourceRefs(capability),
      dev: envEntry(capability, "dev"),
      test: envEntry(capability, "test"),
      staging: envEntry(capability, "staging"),
      prod: envEntry(capability, "prod"),
    })),
  });
}

function strengthenOperationalSemantics() {
  writeJson("operational-semantics.json", {
    artefact: "operational-semantics",
    version: 2,
    mandatoryFoundationAsset: true,
    coverage: {
      source: "docs/v2-foundation/v1-capability-closure.json",
      deliveredCapabilities: capabilities.length,
      enforcedBy: "tools/v2-readiness/src/rules/r27-operational-semantics.mjs",
    },
    capabilities: capabilities.map((capability) => {
      const slug = capabilitySlug(capability.capability);
      const proofs = evidenceRefs(capability);
      const db = hasDatabase(capability);
      const tenant = isTenantData(capability);
      const provider = isProviderBacked(capability);
      return {
        capability: capability.capability,
        category: capability.category,
        providerBacked: provider,
        databaseBacked: db,
        tenantData: tenant,
        deployBehaviour: `${capability.capability} deploys the V1-proven contract "${capability.contract || capability.port || capability.route}" and must keep the semanticCompleteness lifecycle/readiness model unchanged during V2 extraction.`,
        configBehaviour: `${capability.capability} configuration is read from the declared provider/config plane; missing or invalid config fails closed instead of inventing UI defaults.`,
        migrationBehaviour: db
          ? `${capability.capability} database changes use ordered SQL migrations in apps/platform-api/src/db/migrations and must preserve the proven state model: ${capability.semanticCompleteness?.stateModel || capability.contract}.`
          : `${capability.capability} has no owned database schema; migrations are limited to contract/config references and must update semantic artefacts when behaviour changes.`,
        rollbackBehaviour: db
          ? `${capability.capability} rollback is forward-fix or guarded restore after migration lineage is verified; tenant data cannot be silently dropped or remapped.`
          : `${capability.capability} rollback restores the previous contract/config implementation and re-runs the named proof evidence.`,
        backupRestoreRelationship: tenant
          ? `${capability.capability} participates in tenant backup/export/retention/legal-hold semantics; recovery must preserve tenant boundary, audit, and DSR/GDPR evidence.`
          : `${capability.capability} does not own tenant records; backup scope is configuration/evidence only and restore cannot create tenant data.`,
        partialFailureBehaviour: provider
          ? `${capability.capability} provider failure returns typed degraded/readiness failure, keeps mutation boundaries closed, and does not fabricate successful provider state.`
          : `${capability.capability} local failure returns typed platform error or readiness degraded state without changing tenant-visible semantics.`,
        degradedMode: provider
          ? `${capability.capability} degraded mode disables mutation/side-effect paths that depend on ${capability.adapter || capability.port || "the provider"} while keeping read-only readiness and audit visible.`
          : `${capability.capability} has no external degraded provider mode; unavailable local dependencies fail closed through the readiness model.`,
        recoveryAction: `Operator fixes ${capability.capability} code/config/provider state, then re-runs ${proofs.join(", ") || firstProof(capability)} before promotion continues.`,
        observabilitySignals: [
          `${capability.category}.${slug}.readiness`,
          `${capability.category}.${slug}.errors`,
          `${capability.category}.${slug}.audit`,
        ],
        metrics: [`${slug}_request_total`, `${slug}_failure_total`, `${slug}_readiness_state`],
        logs: [
          `${capability.capability} typed error log with organisationId when tenant-scoped`,
          `${capability.capability} promotion/readiness proof log`,
        ],
        traces: [`${capability.capability} route/usecase/provider span preserving tenant context`],
        alertConditions: [
          `${capability.capability} readiness is blocked or unavailable`,
          `${capability.capability} proof or smoke check fails during promotion`,
          tenant
            ? `${capability.capability} tenant isolation/audit signal is missing`
            : `${capability.capability} repeated typed errors exceed threshold`,
        ],
        runbookReference: "docs/v2-foundation/v2-branch-cut-runbook.md",
        incidentClass:
          tenant ||
          /security|auth|secret|permission|audit/i.test(
            `${capability.capability} ${capability.category}`
          )
            ? "tenant-data-or-security"
            : provider
              ? "provider-dependency"
              : "platform-foundation",
        dataLossRisk: tenant
          ? "tenant data loss possible if migration/restore/export semantics are bypassed"
          : "no owned tenant data; risk is semantic drift or configuration loss",
        securityRisk: /secret|auth|permission|rbac|abac|audit|identity|tenant/i.test(
          `${capability.capability} ${capability.category}`
        )
          ? "security-sensitive capability; permission, audit, and fail-closed behaviour must be preserved"
          : "standard platform security controls apply",
        tenantImpact: tenant
          ? `${capability.capability} can affect tenant-visible data or access and must preserve isolation.`
          : `${capability.capability} affects shared platform behaviour without owning tenant records.`,
        operatorAction: `Inspect ${capability.capability} readiness, logs, traces, and proof output; fix source/config/provider state; re-run ${proofs.join(", ") || firstProof(capability)}.`,
        proofReference: proofs,
        sourceFileRefs: capabilitySourceRefs(capability),
      };
    }),
  });
}

function eventSourceRefs(eventName) {
  const refs = {
    "tenant.config.changed": [
      "apps/platform-api/src/usecases/webhook-worker.ts",
      "apps/platform-api/scripts/webhook-worker-runtime-proof.ts",
      "apps/platform-api/scripts/webhook-redrive-runtime-proof.ts",
      "apps/platform-api/tests/unit/webhook-worker.test.ts",
    ],
    "report.run": [
      "apps/platform-api/src/usecases/scheduled-jobs.ts",
      "apps/platform-api/scripts/scheduled-job-routes-runtime-proof.ts",
      "apps/platform-api/tests/unit/scheduled-jobs.test.ts",
    ],
    "platform.test": [
      "apps/platform-api/scripts/webhooks-runtime-proof.ts",
      "apps/platform-api/tests/unit/webhooks.test.ts",
      "apps/platform-api/tests/unit/webhook-worker.test.ts",
    ],
    "thing.created": [
      "apps/platform-api/scripts/event-bus-runtime-proof.ts",
      "apps/platform-api/tests/unit/events.test.ts",
    ],
    x: [
      "apps/platform-api/scripts/event-bus-runtime-proof.ts",
      "apps/platform-api/tests/unit/events.test.ts",
    ],
    boom: ["apps/platform-api/tests/unit/events.test.ts"],
    "no.handler": ["apps/platform-api/tests/unit/events.test.ts"],
    t: ["apps/platform-api/tests/unit/events.test.ts"],
    "ok.event": ["apps/platform-api/scripts/event-worker-runtime-proof.ts"],
    "boom.event": [
      "apps/platform-api/scripts/event-worker-runtime-proof.ts",
      "apps/platform-api/scripts/event-redrive-runtime-proof.ts",
    ],
  };
  return refs[eventName] || [];
}

function canonicalEvent(eventName, category, owner, producer, consumers, proof, payloadFields) {
  return {
    eventName,
    category,
    owner,
    producer,
    consumers,
    schema: {
      schemaVersion: "1.0.0",
      type: "object",
      additionalProperties: false,
      required: payloadFields,
      properties: Object.fromEntries(payloadFields.map((field) => [field, { type: "string" }])),
    },
    schemaVersion: "1.0.0",
    version: 1,
    payloadContract: `Payload contains only ${payloadFields.join(", ")} and the platform envelope fields organisationId, eventName, idempotencyKey, createdAt, and source id. Arbitrary payload is not allowed for canonical ${eventName}.`,
    idempotencyKey: "organisationId + eventName + caller-supplied idempotencyKey",
    orderingExpectation:
      "ordered per organisation and idempotency key; no cross-tenant ordering guarantee",
    retryPolicy:
      "worker/webhook delivery retries with bounded backoff and records exhausted attempts",
    dlqPolicy:
      "dead-letter entry stores tenant, event type, attempts, payload summary, and last error; redrive uses a fresh idempotency key",
    retention:
      "event rows and dead-letter evidence retained according to tenant data retention and audit policy",
    privacyClassification: "tenant-operational",
    tenantIsolation:
      "organisationId partitions event persistence, delivery, DLQ, and redrive; consumers must re-check tenant context",
    auditRelationship: `${eventName} is linked to producer mutation audit and redrive/delivery audit evidence.`,
    sourceFileRefs: eventSourceRefs(eventName),
    proof,
    environmentBehaviour: {
      dev: "local composed event/webhook provider; fixture payloads allowed only in tests",
      test: "deterministic event worker and repository proofs run with disposable data",
      staging: "prod-shape queue/webhook topology with sandbox endpoints and redrive rehearsal",
      prod: "real tenant event delivery only; no fixture/test event emission or destructive redrive proof",
    },
    breakingChangePolicy:
      "Schema changes require a new schemaVersion, backwards-compatible consumers, semantic artefact updates, and migration/redrive compatibility evidence before V2 promotion.",
  };
}

function testOnlyEvent(eventName, rationale, proof) {
  return {
    eventName,
    category: "test-only",
    owner: "platform-event-tests",
    producer: "test or runtime-proof fixture only",
    consumers: ["test fixture handler"],
    schema: {
      schemaVersion: "fixture",
      type: "object",
      additionalProperties: true,
      arbitraryPayloadJustification:
        "fixture event intentionally exercises generic event-bus storage/retry/DLQ behaviour and is excluded from product/platform readiness semantics",
    },
    schemaVersion: "fixture",
    version: 0,
    payloadContract:
      "fixture-only payload; not a product/platform contract and not available to generated UI",
    idempotencyKey: "fixture idempotency key scoped to disposable proof/test tenant",
    orderingExpectation:
      "fixture ordering only within the event-bus proof under disposable tenant data",
    retryPolicy: "uses event-bus retry path only to prove infrastructure behaviour",
    dlqPolicy: "uses event-bus DLQ path only to prove infrastructure behaviour",
    retention: "discarded with test/proof data",
    privacyClassification: "fixture",
    tenantIsolation: "disposable proof/test tenant only; never production tenant data",
    auditRelationship: "none for product audit; fixture redrive evidence remains proof-only",
    sourceFileRefs: eventSourceRefs(eventName),
    proof,
    environmentBehaviour: {
      dev: "allowed only inside local proof/test fixture",
      test: "allowed only inside deterministic automated tests",
      staging:
        "forbidden except isolated rehearsal fixture that is excluded from readiness semantics",
      prod: "forbidden",
    },
    breakingChangePolicy:
      "may change with tests because it is not canonical; cannot be promoted to product semantics without a new canonical event record",
    fixtureRationale: rationale,
    excludedFromProductReadiness: true,
  };
}

function strengthenEventSemantics() {
  writeJson("event-semantics.json", {
    artefact: "event-semantics",
    version: 2,
    mandatoryFoundationAsset: true,
    coverage: {
      discoveredEventNames: [
        "boom",
        "boom.event",
        "no.handler",
        "ok.event",
        "platform.test",
        "report.run",
        "t",
        "tenant.config.changed",
        "thing.created",
        "x",
      ],
      canonicalEvents: ["tenant.config.changed", "report.run"],
      testOnlyEvents: [
        "thing.created",
        "x",
        "boom",
        "no.handler",
        "t",
        "ok.event",
        "boom.event",
        "platform.test",
      ],
      enforcedBy: "tools/v2-readiness/src/rules/r26-event-semantics.mjs",
    },
    events: [
      canonicalEvent(
        "tenant.config.changed",
        "integration",
        "webhooks",
        "Webhook worker and tenant configuration mutation surfaces",
        ["developer webhooks", "webhook delivery worker", "webhook redrive"],
        "proof:webhooks; proof:webhook-redrive",
        ["key"]
      ),
      canonicalEvent(
        "report.run",
        "platform",
        "scheduled-jobs",
        "Workflow engine and scheduled job use cases",
        ["scheduled job dispatcher", "event substrate"],
        "proof:scheduled-jobs; proof:scheduled-job-routes",
        ["reportId"]
      ),
      testOnlyEvent(
        "platform.test",
        "webhook subscription and delivery tests use this synthetic event name",
        "proof:webhooks"
      ),
      testOnlyEvent(
        "thing.created",
        "event-bus persistence/idempotency proof fixture",
        "proof:event-bus"
      ),
      testOnlyEvent("x", "event-bus payload redaction proof fixture", "proof:event-bus"),
      testOnlyEvent("boom", "event worker failure/DLQ unit-test fixture", "proof:event-worker"),
      testOnlyEvent("no.handler", "event worker no-handler branch fixture", "proof:event-worker"),
      testOnlyEvent("t", "event bus tenant isolation unit-test fixture", "proof:event-bus"),
      testOnlyEvent("ok.event", "event worker success runtime-proof fixture", "proof:event-worker"),
      testOnlyEvent(
        "boom.event",
        "event worker and redrive failure runtime-proof fixture",
        "proof:event-worker; proof:event-redrive"
      ),
    ],
  });
}

function interaction(id, producer, consumer, type, contract, proof, evidence) {
  return {
    id,
    producerCapability: producer,
    consumerCapability: consumer,
    interactionType: type,
    sharedContract: contract,
    dataOwnershipBoundary: `${producer} owns its source state; ${consumer} may read or act only through the shared contract.`,
    controlOwnershipBoundary: `${producer} controls mutation semantics; ${consumer} controls its local reaction and must not infer missing producer state.`,
    ownershipBoundary: `${producer} owns producer state; ${consumer} owns consumer state.`,
    failureBehaviour: `${consumer} fails closed or remains pending when ${producer} proof/readiness is unavailable.`,
    orderingRequirement:
      "producer state/readiness is established before consumer mutation or side effect",
    retryIdempotencyBehaviour:
      "retries use tenant-scoped idempotency and must not duplicate side effects",
    consistencyModel:
      type === "event"
        ? "eventual consistency with idempotent consumer replay"
        : "read-committed platform state with explicit readiness dependency",
    transactionBoundary: `${producer} transaction is not shared with ${consumer}; cross-capability work uses explicit handoff and compensation.`,
    compensationBehaviour:
      "partial consumer state is retried, redriven, or marked pending; producer-owned state is not silently rolled back by consumer failure",
    environmentBehaviour: {
      dev: "local composed provider or fixture dependency for discovery",
      test: "deterministic proof using disposable tenant data",
      staging: "prod-shape rehearsal with sandbox external dependencies where needed",
      prod: "real tenant operation with non-destructive smoke/readiness only",
    },
    securityBoundary:
      "tenant context, permissions, secrets, and provider credentials do not cross the boundary except through the declared contract",
    auditBoundary:
      "producer mutation audit remains producer-owned; consumer audit records its reaction, delivery, or readiness state",
    proofReference: proof,
    sourceEvidence: evidence,
  };
}

function strengthenInteractions() {
  const rows = [
    interaction(
      "entitlements-billing",
      "Entitlement engine",
      "Subscriptions, invoices, payment methods, dunning",
      "readiness-dependency",
      "Entitlement/quota grants gate billing account, subscription, usage, and payment behaviour",
      "proof:entitlement-policy-chain; proof:billing-provider; proof:lago-billing-provider",
      [
        "apps/platform-api/scripts/entitlement-policy-chain-runtime-proof.ts",
        "apps/platform-api/scripts/billing-runtime-proof.ts",
      ]
    ),
    interaction(
      "billing-workflow",
      "Usage metering + meter event ingestion",
      "Workflow engine, scheduled jobs, approvals",
      "workflow",
      "Metered usage and scheduled billing jobs share tenant-scoped event/job contracts",
      "proof:metering; proof:scheduled-jobs",
      [
        "apps/platform-api/scripts/metering-runtime-proof.ts",
        "apps/platform-api/scripts/scheduled-jobs-runtime-proof.ts",
      ]
    ),
    interaction(
      "workflow-notifications",
      "Workflow engine, scheduled jobs, approvals",
      "Notification delivery + preferences + channels",
      "event",
      "Workflow events request notifications only after preference/channel checks",
      "proof:workflow-provider-live; proof:notification-dispatch",
      [
        "apps/platform-api/scripts/notification-dispatch-runtime-proof.ts",
        "apps/platform-api/scripts/event-worker-runtime-proof.ts",
      ]
    ),
    interaction(
      "storage-governance",
      "Object storage + tenant prefixes + signed URLs",
      "Data governance: catalog, lineage, classification, PII, DSR/GDPR",
      "data-reference",
      "Governance references storage object metadata without taking ownership of bytes",
      "proof:tenant-storage-objects; proof:data-governance",
      [
        "apps/platform-api/scripts/storage-runtime-proof.ts",
        "apps/platform-api/tests/unit/data-governance.test.ts",
      ]
    ),
    interaction(
      "governance-tenant-lifecycle",
      "Tenant lifecycle: provision, suspend, delete, export",
      "Data governance: catalog, lineage, classification, PII, DSR/GDPR",
      "lifecycle-dependency",
      "Lifecycle export/delete/suspend semantics require governance retention, DSR, and legal-hold decisions",
      "proof:tenant-lifecycle; proof:data-governance; proof:legal-hold",
      [
        "apps/platform-api/scripts/tenant-lifecycle-runtime-proof.ts",
        "apps/platform-api/tests/unit/data-governance.test.ts",
      ]
    ),
    interaction(
      "audit-privileged-access",
      "Support-mode / break-glass access",
      "Audit of privileged access",
      "audit-dependency",
      "Support/break-glass access cannot proceed without privileged audit event evidence",
      "proof:support-approval; proof:compliance-report",
      [
        "apps/platform-api/tests/unit/support-mode.test.ts",
        "apps/platform-api/tests/unit/audit.test.ts",
      ]
    ),
    interaction(
      "catalog-provider-readiness",
      "Internal service catalog + readiness",
      "Composed provider readiness spine",
      "provider-dependency",
      "Provider readiness entries expose service catalogue status and clickthrough only when capability readiness is true",
      "proof:service-catalog-registry; proof:composed-provider-readiness",
      [
        "apps/platform-api/scripts/service-catalog-registry-runtime-proof.ts",
        "apps/platform-api/scripts/composed-provider-readiness-runtime-proof.ts",
      ]
    ),
    interaction(
      "events-workers-dlq",
      "Event bus, durable queues, DLQ, redrive",
      "Background workers / job runner",
      "event",
      "Workers consume event-bus records, apply retry/DLQ/redrive semantics, and keep producer mutation state independent",
      "proof:event-bus; proof:event-worker; proof:event-redrive",
      [
        "apps/platform-api/scripts/event-bus-runtime-proof.ts",
        "apps/platform-api/scripts/event-worker-runtime-proof.ts",
        "apps/platform-api/scripts/event-redrive-runtime-proof.ts",
      ]
    ),
    interaction(
      "webhooks-events",
      "Event bus, durable queues, DLQ, redrive",
      "Webhooks (developer-facing)",
      "event",
      "Canonical tenant events are delivered to developer webhooks through subscribed event types and redriveable delivery records",
      "proof:webhooks; proof:webhook-redrive",
      [
        "apps/platform-api/src/usecases/webhook-worker.ts",
        "apps/platform-api/scripts/webhook-redrive-runtime-proof.ts",
      ]
    ),
    interaction(
      "tenant-identity-access",
      "Tenant identity (record + FQDN)",
      "User identity + tenant membership",
      "sync-api",
      "Request tenant identity scopes membership resolution, session context, and route permission checks",
      "proof:domain-identity-matrix; proof:tenant-custom-domain-resolution",
      [
        "apps/platform-api/src/server/tenant-resolver.ts",
        "apps/platform-api/src/server/pipeline.ts",
      ]
    ),
  ];
  for (const row of rows) {
    if (
      !capabilityNames.has(row.producerCapability) ||
      !capabilityNames.has(row.consumerCapability)
    ) {
      throw new Error(`interaction references unknown capability: ${row.id}`);
    }
  }
  writeJson("cross-capability-interactions.json", {
    artefact: "cross-capability-interactions",
    version: 2,
    mandatoryFoundationAsset: true,
    coverage: {
      source: [
        "docs/v2-foundation/v1-capability-closure.json",
        "docs/v2-foundation/event-semantics.json",
        "docs/v2-foundation/environment-capability-matrix.json",
        "docs/v2-foundation/operational-semantics.json",
      ],
      interactionTypes: [
        "sync-api",
        "event",
        "workflow",
        "data-reference",
        "readiness-dependency",
        "provider-dependency",
        "audit-dependency",
        "lifecycle-dependency",
      ],
      enforcedBy: "tools/v2-readiness/src/rules/r25-cross-capability-semantics.mjs",
    },
    interactions: rows,
  });
}

function proofLevelFor(record) {
  const text = words(
    `${record.path} ${record.kind} ${record.behaviourProtected} ${record.stageCoverage}`
  );
  if (/runtime-proof|substrate|postgres|redis|compose|e2e|playwright/.test(text)) return 4;
  if (/integration|db|security|contract/.test(text)) return 3;
  if (/unit|frontend|test\.tsx/.test(text)) return 2;
  return 2;
}

function providerClassForProof(record) {
  const text = words(`${record.path} ${record.kind} ${record.fixtureEnvDependency}`);
  if (/brevo|lago|keycloak|oidc|webhook|smtp|s3|object|openbao/.test(text))
    return "sandbox-external";
  if (/postgres|redis|compose|substrate|runtime-proof|db|e2e/.test(text)) return "compose-local";
  return "hermetic";
}

function strengthenProofInventory() {
  const updated = proofInventory.map((record) => {
    const level = record.proofLevel ?? proofLevelFor(record);
    const providerClass = record.providerClass || providerClassForProof(record);
    const destructive =
      record.destructive ??
      /delete|restore|redrive|rollback|migration|lifecycle|failure/i.test(record.path || "");
    const prodSafe = record.prodSafe ?? !destructive;
    const capabilitiesProven =
      record.capabilitiesProven ||
      capabilities
        .filter((capability) =>
          words(record.path).includes(capabilitySlug(capability.capability).split("-")[0])
        )
        .slice(0, 3)
        .map((capability) => capability.capability);
    return {
      ...record,
      proofLevel: level,
      proofLevelRationale:
        record.proofLevelRationale ||
        (level >= 4
          ? "Exercises live or compose-backed substrate/provider behaviour rather than route presence alone."
          : level === 3
            ? "Validates behaviour/state/permission contract in automated integration or contract scope."
            : "Validates deterministic unit/component behaviour and supports, but does not alone close, foundational semantics."),
      capabilitiesProven: capabilitiesProven.length
        ? capabilitiesProven
        : ["shared platform proof inventory"],
      semanticFacetsProven:
        record.semanticFacetsProven ||
        (level >= 4
          ? ["contracts", "stateModel", "readinessModel", "proof"]
          : level === 3
            ? ["contracts", "validation", "errorModel"]
            : ["validation"]),
      environment: record.environment || (level >= 4 ? "test" : "test"),
      providerClass,
      liveSubstrateUsed: record.liveSubstrateUsed ?? level >= 4,
      destructive,
      prodSafe,
      sourceCommand:
        record.sourceCommand ||
        (record.path?.startsWith("apps/platform-api/scripts/")
          ? `tsx ${record.path}`
          : record.path?.includes("/tests/")
            ? `npm test -- ${record.path}`
            : "npm test"),
      scriptPath:
        record.scriptPath ||
        (record.path?.startsWith("apps/platform-api/scripts/") ? record.path : null),
      expectedFailureMode:
        record.expectedFailureMode ||
        "command exits non-zero with assertion/spec failure when the protected semantic contract is broken",
    };
  });
  writeJson("v1-test-proof-inventory.json", updated);

  const proofDefinition = readJson("capability-proof-definition.json");
  proofDefinition.version = 2;
  proofDefinition.minimumDefinition = {
    ...proofDefinition.minimumDefinition,
    proofLevelRationale: "required for every proof inventory record",
    capabilitiesProven:
      "array of named capabilities or empty only when the proof validates shared tool/runtime infrastructure",
    semanticFacetsProven: "array naming the semantic facets the proof can actually support",
    environment: "dev, test, staging, or prod",
    providerClass: "hermetic, compose-local, sandbox-external, live-external, or none",
    liveSubstrateUsed: "boolean",
    destructive: "boolean",
    prodSafe: "boolean; destructive proofs must be false",
    sourceCommand: "command that runs the proof",
    scriptPath: "runtime proof script path or null for tests",
    expectedFailureMode: "how failure is observed",
  };
  proofDefinition.rules = [
    "Level 0/1 proofs cannot close foundational capability semantics.",
    "Provider-backed capabilities require Level 4 unless explicitly external-limited in the capability evidence.",
    "Critical cross-capability journeys require Level 5 or documented rationale.",
    "Prod-safe proofs must be non-destructive.",
    "Destructive proofs must be dev/test/staging only.",
  ];
  writeJson("capability-proof-definition.json", proofDefinition);
}

function writeEnvironmentGates() {
  writeJson("environment-readiness-gates.json", {
    artefact: "environment-readiness-gates",
    version: 1,
    mandatoryFoundationAsset: true,
    enforcedBy: "tools/v2-readiness/src/rules/r29-environment-readiness-gates.mjs",
    dev: {
      purpose: "fast local discovery that is complete enough to prove semantics before promotion",
      requiredCommands: ["npm run v2:readiness -- --json", "npm test -- tools/v2-readiness"],
      requiredProofLevels: [2, 3],
      allowedProviders: ["hermetic", "compose-local", "sandbox-external"],
      allowedMocks: true,
      dataPolicy: "fixture or disposable local tenant data only",
      forbiddenProofs: ["production destructive proof", "paid live-only provider dependency"],
    },
    test: {
      purpose:
        "deterministic automated proof of semantic, state, permission, and provider contracts",
      requiredCommands: ["npm run v2:readiness -- --strict", "npm test -- tools/v2-readiness"],
      requiredProofLevels: [3, 4],
      allowedProviders: ["hermetic", "compose-local", "sandbox-external"],
      allowedMocks: true,
      deterministicDataPolicy:
        "fixed fixtures and disposable compose data; no production tenant data",
      forbiddenProofs: [
        "paid live-only provider requirement",
        "non-deterministic external dependency",
      ],
    },
    staging: {
      purpose: "production-shape rehearsal before V2 cut or release promotion",
      requiredCommands: ["make stage-staging", "npm run v2:readiness -- --strict"],
      requiredProofLevels: [4, 5],
      allowedProviders: ["hermetic", "compose-local", "sandbox-external", "live-external"],
      allowedMocks: false,
      prodShapeChecks: [
        "topology mirrors production service boundaries",
        "observability, secret manager, migration, and rollback rehearsal enabled",
      ],
      migrationRehearsal:
        "ordered SQL migrations and data governance evidence are rehearsed against disposable staging tenant data",
      rollbackRehearsal: "rollback/forward-fix path is rehearsed and evidence is retained",
      sandboxProviderChecks:
        "external integrations use sandbox credentials and production-shaped contracts",
    },
    prod: {
      purpose: "real tenant operation with only current non-destructive health and smoke evidence",
      requiredCommands: ["make stage-prod", "npm run v2:readiness -- --strict"],
      requiredProofLevels: [0],
      allowedProviders: ["live-external", "compose-local", "hermetic"],
      allowedMocks: false,
      smokeChecks: ["current health/readiness", "synthetic non-destructive journeys only"],
      readinessChecks: [
        "semantic artefact validators",
        "service health",
        "observability signal presence",
      ],
      forbiddenProofs: [
        "destructive proof",
        "fixture event emission",
        "mock provider",
        "test data insertion",
      ],
      observabilityChecks: [
        "metrics, logs, traces, alert routing, and incident evidence present before promotion",
      ],
    },
  });
}

strengthenEnvironmentMatrix();
strengthenOperationalSemantics();
strengthenEventSemantics();
strengthenInteractions();
strengthenProofInventory();
writeEnvironmentGates();
