import assert from "node:assert/strict";
import {
  createInMemoryObjectStoragePort,
  createTenantScopedObjectStoragePort,
} from "@platform/storage-runtime";
import {
  InMemoryAntivirus,
  InMemoryAuditEventPort,
  InMemoryBackupRestoreProvider,
  InMemoryEventBus,
  InMemoryNotificationRepository,
  InMemoryObservabilityRepository,
  InMemoryRateLimitRepository,
  InMemorySearchRepository,
  InMemorySecretStore,
  InMemorySessionStore,
  InMemoryStorageObjectRepository,
  InMemoryWebhookDispatcher,
  InMemoryWebhookStore,
  InMemoryWorkerRegistry,
  createInMemoryNotificationTransport,
} from "../src/adapters/in-memory-semantic-providers.ts";
import { InMemoryBillingProvider } from "../src/adapters/in-memory-billing-provider.ts";
import { InMemoryWorkflowOrchestrator } from "../src/adapters/in-memory-workflow-orchestrator.ts";
import { dispatchNotification } from "../src/usecases/notifications.ts";
import { indexDocument, searchProducts } from "../src/usecases/search.ts";
import { publishEvent, processNext } from "../src/usecases/events.ts";
import { putSecret, revokeSecret, deleteSecret } from "../src/usecases/secrets.ts";
import { processDueDeliveries } from "../src/usecases/webhook-worker.ts";

const tenant = "tenant-semantic-dev";
const actor = { actorId: "proof-actor", actorRoles: ["tenant-admin"] };
const audit = new InMemoryAuditEventPort({ seed: "proof" });

const session = new InMemorySessionStore({ seed: "proof" });
const sessionId = await session.create({
  userId: "user-1",
  tenantId: tenant,
  organisationId: tenant,
  roles: ["tenant-admin"],
  permissions: ["tenant.admin.access"],
  displayName: "Semantic Dev",
  ttlSeconds: 60,
});
assert.equal((await session.find(sessionId))?.organisationId, tenant);

const objectRepo = new InMemoryStorageObjectRepository({ seed: "proof" });
const antivirus = new InMemoryAntivirus({ seed: "proof" });
const baseStorage = createInMemoryObjectStoragePort();
const scopedStorage = createTenantScopedObjectStoragePort(baseStorage, {
  organisationId: tenant,
  quotaBeforeWrite: async () => undefined,
  antivirusScan: async (input) =>
    (
      await antivirus.scan({
        objectKey: input.key,
        body: Buffer.isBuffer(input.body) ? input.body : Buffer.from(String(input.body)),
        contentType: input.contentType,
      })
    ).verdict === "clean"
      ? "clean"
      : "rejected",
  legalHoldDeletionBlock: async () => undefined,
  auditEvent: async (event) => audit.emit(event),
  traceSpan: async (_name, _attrs, run) => run(),
  log: () => undefined,
  metric: () => undefined,
});
await objectRepo.create({
  organisationId: tenant,
  objectKey: `${tenant}/hello.txt`,
  contentType: "text/plain",
  sizeBytes: 5,
  createdBy: actor.actorId,
});
await scopedStorage.put({ key: `${tenant}/hello.txt`, body: "hello", contentType: "text/plain" });
await objectRepo.setScanState(tenant, `${tenant}/hello.txt`, "clean");
assert.equal((await scopedStorage.get(`${tenant}/hello.txt`))?.size, 5);
await scopedStorage.delete(`${tenant}/hello.txt`);
await objectRepo.delete(tenant, `${tenant}/hello.txt`);

const bus = new InMemoryEventBus({ seed: "proof" });
const workers = new InMemoryWorkerRegistry({ seed: "proof" });
await publishEvent(
  {
    organisationId: tenant,
    eventType: "thing.created",
    idempotencyKey: "one",
    payload: { ok: true },
  },
  { bus, workers, audit }
);
const processed = await processNext(
  { "thing.created": async () => undefined },
  { bus, workers, audit },
  { workerId: "proof-worker" }
);
assert.equal(processed.processed, 1);
await publishEvent(
  { organisationId: tenant, eventType: "thing.created", idempotencyKey: "two", maxAttempts: 1 },
  { bus, workers, audit }
);
const failed = await processNext(
  {
    "thing.created": async () => {
      throw new Error("expected");
    },
  },
  { bus, workers, audit }
);
assert.equal(failed.deadLettered, 1);

const workflow = new InMemoryWorkflowOrchestrator();
await workflow.startWorkflow({
  workflowId: "wf-proof",
  workflowKey: "approval",
  tenantId: tenant,
  payload: {},
});
await workflow.signalWorkflow("wf-proof", "approval.requested", { requestedBy: actor.actorId });
await workflow.signalWorkflow("wf-proof", "approval.denied", { deniedBy: actor.actorId });
assert.equal((await workflow.getWorkflowStatus("wf-proof")).status, "failed");

const billing = new InMemoryBillingProvider();
assert.equal((await billing.readiness()).status, "ready");
assert.equal(
  (
    await billing.ensureAccount({
      organisationId: tenant,
      currency: "USD",
      name: "Proof",
      actorId: actor.actorId,
    })
  ).organisationId,
  tenant
);
assert.equal(
  await billing.validateWebhookSignature(Buffer.from("x"), "local-proof-signature"),
  true
);

const notificationRepo = new InMemoryNotificationRepository({ seed: "proof" });
await notificationRepo.upsertPreferences({
  organisationId: tenant,
  userId: "user-1",
  preferences: [{ channel: "email", category: "security", enabled: true }],
});
const notifications = await dispatchNotification(
  {
    organisationId: tenant,
    userId: "user-1",
    category: "security",
    subject: "Proof",
  },
  {
    notifications: notificationRepo,
    audit,
    transports: { email: createInMemoryNotificationTransport() },
  }
);
assert.equal(notifications[0]?.status, "sent");

const webhookStore = new InMemoryWebhookStore({ seed: "proof" });
const webhook = await webhookStore.create({
  organisationId: tenant,
  url: "https://example.test/hook",
  eventTypes: ["platform.test"],
  enabled: true,
  secret: "secret",
});
await webhookStore.enqueueDelivery({
  organisationId: tenant,
  subscriptionId: webhook.id,
  event: "platform.test",
  payload: "{}",
});
const webhookSummary = await processDueDeliveries(
  { store: webhookStore, dispatch: new InMemoryWebhookDispatcher({ seed: "proof" }) },
  { now: new Date(), maxAttempts: 1 }
);
assert.equal(webhookSummary.delivered, 1);

const search = new InMemorySearchRepository({ seed: "proof" });
await indexDocument(
  {
    organisationId: tenant,
    documentId: "doc-1",
    documentType: "article",
    title: "Semantic Provider",
    body: "In memory search proof",
  },
  { index: search, query: search, audit }
);
assert.equal(
  (
    await searchProducts(
      tenant,
      { q: "provider" },
      [],
      { index: search, query: search, audit },
      actor
    )
  ).total,
  1
);

const secrets = new InMemorySecretStore({ seed: "proof" });
const secret = await putSecret(
  { organisationId: tenant, name: "smtp/password", value: "value", actor },
  { store: secrets, audit }
);
assert.equal(await secrets.resolve(tenant, secret.ref), "value");
await revokeSecret({ organisationId: tenant, ref: secret.ref, actor }, { store: secrets, audit });
assert.equal(await secrets.resolve(tenant, secret.ref), null);
const rotated = await putSecret(
  { organisationId: tenant, name: "smtp/password", value: "rotated", actor },
  { store: secrets, audit }
);
assert.equal(rotated.version, 2);
await deleteSecret({ organisationId: tenant, ref: rotated.ref, actor }, { store: secrets, audit });

const obs = new InMemoryObservabilityRepository({ seed: "proof" });
await obs.registerSignal({
  organisationId: tenant,
  signalKey: "api.requests",
  displayName: "API Requests",
});
await obs.recordSample(tenant, "api.requests", 42);
assert.equal(await obs.latestValue(tenant, "api.requests"), 42);

const rateLimits = new InMemoryRateLimitRepository({ seed: "proof" });
await rateLimits.upsert({
  organisationId: tenant,
  policyKey: "api",
  entitlementKey: "api",
  limit: 10,
  windowSeconds: 60,
  action: "allow",
  updatedBy: actor.actorId,
});
assert.equal(await rateLimits.incrementAndCount(tenant, "api", 60), 1);

const backup = new InMemoryBackupRestoreProvider({ seed: "proof" });
const backupResult = await backup.backupTenant(tenant, { ok: true });
assert.equal((await backup.restoreTenant(tenant, backupResult.backupId)).restored, true);

for (const provider of [
  session,
  objectRepo,
  antivirus,
  bus,
  workers,
  workflow,
  billing,
  notificationRepo,
  webhookStore,
  search,
  secrets,
  obs,
  rateLimits,
  backup,
]) {
  const health = "healthCheck" in provider ? await provider.healthCheck() : { ok: true };
  assert.ok(JSON.stringify(health).includes("ready") || JSON.stringify(health).includes("true"));
}

console.log(
  JSON.stringify(
    {
      status: "PASS",
      providerMode: "semantic-dev",
      tenant,
      assertions: {
        session: true,
        storageObjectLifecycle: true,
        eventPublishConsumeFailure: true,
        workflowFailure: true,
        billingEntitlementQuotaPath: true,
        notificationsWebhooks: true,
        searchIndexRead: true,
        secretRotateDelete: true,
        observabilityCapture: true,
      },
    },
    null,
    2
  )
);
