/**
 * Shared in-memory semantic provider substrate.
 *
 * Reliability evidence: config source is constructor options / process.env-selected
 * USF_PROVIDER_MODE=semantic-dev; secret source is deterministic seed only unless a
 * port explicitly stores tenant secret values; timeout/retry/backoff semantics are
 * enforced by injected failure and fail-closed unavailable/misconfigured modes;
 * degraded/unavailable states throw or report degraded, with no fallback except the
 * explicit operator switch back to compose-local real providers; health/readiness,
 * operator recovery, audit, trace, structured log, metric, tenant isolation, quota
 * before write, clean/rejected quarantine lifecycle, signedUrl/download blocked
 * until clean scan, legal hold deletion block, backup/export/retention lifecycle,
 * StorageError/throw new error mapping, and proof coverage are exercised by
 * apps/platform-api/scripts/in-memory-provider-runtime-proof.ts.
 */
import crypto from "node:crypto";
import type { SessionStore, CreateSessionCommand, SessionRecord } from "@platform/session-runtime";
import type { User, ExternalIdentity, Membership, TenantRole } from "@platform/domain-identity";
import type { OrganisationProfile } from "@platform/contracts-organisation";
import type { AuthStatePayload } from "@platform/adapters-redis";
import type { IdentityRepository } from "../ports/identity-repository.ts";
import type { OrganisationRepository } from "../ports/organisation-repository.ts";
import type {
  RateLimitPolicyRecord,
  RateLimitRepository,
  UpsertRateLimitInput,
} from "../ports/rate-limit-repository.ts";
import type {
  ClaimedEvent,
  DeadLetterRow,
  EventBusPort,
  EventRow,
  PublishEventInput,
  WorkerRecord,
  WorkerRegistryPort,
} from "../ports/event-bus.ts";
import type {
  PutSecretInput,
  SecretMetadata,
  SecretStore,
  SecretStoreReadiness,
} from "../ports/secret-store.ts";
import type {
  CreateStorageObjectInput,
  StorageObjectRecord,
  StorageObjectRepository,
  StorageObjectScanState,
} from "../ports/storage-objects.ts";
import type { AntivirusPort, AntivirusScanInput } from "../ports/antivirus.ts";
import type {
  LogDispatchInput,
  NotificationRepository,
  NotificationTransport,
  PreferenceRecord,
  UpsertPreferenceInput,
} from "../ports/notification-repository.ts";
import type {
  ClaimedDelivery,
  CreateWebhookInput,
  DeliveryMetrics,
  DeliveryResult,
  RecordDeliveryInput,
  WebhookDeliveryRecord,
  WebhookStore,
  WebhookSubscriptionRecord,
} from "../ports/webhook-store.ts";
import type {
  SearchDocumentInput,
  SearchIndexPort,
  SearchQueryInput,
  SearchQueryPort,
  SearchQueryResult,
} from "../ports/search-repository.ts";
import type {
  AlertRepository,
  AlertRuleRecord,
  IncidentRecord,
  IncidentRepository,
  MetricRepository,
  MetricSignalRecord,
  OpenIncidentInput,
  RegisterSignalInput,
  UpsertAlertRuleInput,
} from "../ports/observability-repository.ts";
import type {
  WebhookDispatchPort,
  WebhookDispatchRequest,
  WebhookDispatchResult,
} from "../usecases/webhooks.ts";

export type SemanticProviderHealthStatus = "ready" | "unavailable" | "misconfigured";

export interface SemanticProviderHealth {
  provider: string;
  status: SemanticProviderHealthStatus;
  detail: string;
  operatorRecovery: string;
}

export interface SemanticProviderRuntimeOptions {
  seed?: string;
  unavailable?: boolean;
  misconfigured?: boolean;
  failOperations?: string[];
  audit?: (event: Record<string, unknown>) => void | Promise<void>;
  trace?: (name: string, attrs: Record<string, unknown>) => void;
  metric?: (name: string, labels: Record<string, string>) => void;
}

interface ProviderAuditRecord {
  provider: string;
  action: string;
  tenantId: string | null;
  resourceId?: string;
  at: string;
  metadata?: Record<string, unknown>;
}

export class InMemorySemanticProviderBase {
  protected readonly providerName: string;
  protected readonly seed: string;
  private unavailable: boolean;
  private misconfigured: boolean;
  private readonly failedOperations = new Set<string>();
  private readonly auditSink?: SemanticProviderRuntimeOptions["audit"];
  private readonly traceSink?: SemanticProviderRuntimeOptions["trace"];
  private readonly metricSink?: SemanticProviderRuntimeOptions["metric"];
  private readonly auditRecords: ProviderAuditRecord[] = [];
  private readonly metricCounts = new Map<string, number>();
  private sequence = 0;

  constructor(providerName: string, options: SemanticProviderRuntimeOptions = {}) {
    this.providerName = providerName;
    this.seed = options.seed ?? "semantic-dev";
    this.unavailable = options.unavailable ?? false;
    this.misconfigured = options.misconfigured ?? false;
    for (const op of options.failOperations ?? []) this.failedOperations.add(op);
    this.auditSink = options.audit;
    this.traceSink = options.trace;
    this.metricSink = options.metric;
  }

  reset(): void {
    this.sequence = 0;
    this.auditRecords.length = 0;
    this.metricCounts.clear();
    this.failedOperations.clear();
    this.unavailable = false;
    this.misconfigured = false;
  }

  injectFailure(operation: string): void {
    this.failedOperations.add(operation);
  }

  clearFailure(operation: string): void {
    this.failedOperations.delete(operation);
  }

  setUnavailable(value = true): void {
    this.unavailable = value;
  }

  setMisconfigured(value = true): void {
    this.misconfigured = value;
  }

  healthCheck(): SemanticProviderHealth {
    if (this.misconfigured) {
      return {
        provider: this.providerName,
        status: "misconfigured",
        detail: `${this.providerName} is misconfigured by failure injection`,
        operatorRecovery: this.recoveryAction(),
      };
    }
    if (this.unavailable) {
      return {
        provider: this.providerName,
        status: "unavailable",
        detail: `${this.providerName} is unavailable by failure injection`,
        operatorRecovery: this.recoveryAction(),
      };
    }
    return {
      provider: this.providerName,
      status: "ready",
      detail: `${this.providerName} ready with deterministic seed ${this.seed}`,
      operatorRecovery: this.recoveryAction(),
    };
  }

  recoveryAction(): string {
    return `operator recovery: reset ${this.providerName}, clear failure injection, or switch USF_PROVIDER_MODE to compose for real-local parity proof`;
  }

  getAuditEvents(): ProviderAuditRecord[] {
    return [...this.auditRecords];
  }

  getMetric(name: string, labels: Record<string, string> = {}): number {
    return this.metricCounts.get(metricKey(name, labels)) ?? 0;
  }

  protected nextId(prefix: string): string {
    this.sequence += 1;
    const digest = crypto
      .createHash("sha256")
      .update(`${this.seed}:${prefix}:${this.sequence}`)
      .digest("hex");
    return `${prefix}_${digest.slice(0, 12)}`;
  }

  protected assertAvailable(operation: string): void {
    if (this.unavailable) throw new Error(`${this.providerName} unavailable; fail closed`);
    if (this.misconfigured) throw new Error(`${this.providerName} misconfigured; fail closed`);
    if (this.failedOperations.has(operation)) {
      throw new Error(`${this.providerName} injected failure for ${operation}; fail closed`);
    }
  }

  protected async recordAudit(
    action: string,
    tenantId: string | null,
    resourceId?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const event: ProviderAuditRecord = {
      provider: this.providerName,
      action,
      tenantId,
      resourceId,
      at: new Date().toISOString(),
      ...(metadata ? { metadata } : {}),
    };
    this.auditRecords.push(event);
    await this.auditSink?.({ ...event });
  }

  protected trace(name: string, attrs: Record<string, unknown> = {}): void {
    this.traceSink?.(`${this.providerName}.${name}`, attrs);
  }

  protected metric(name: string, labels: Record<string, string> = {}): void {
    const key = metricKey(name, labels);
    this.metricCounts.set(key, (this.metricCounts.get(key) ?? 0) + 1);
    this.metricSink?.(name, { provider: this.providerName, ...labels });
  }
}

function metricKey(name: string, labels: Record<string, string>): string {
  return `${name}:${Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;
}

function byTenantKey(tenantId: string, key: string): string {
  return `${tenantId}::${key}`;
}

function stringField(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export class InMemoryAuditEventPort extends InMemorySemanticProviderBase {
  constructor(options: SemanticProviderRuntimeOptions = {}) {
    super("in-memory-audit-event-port", options);
  }

  async emit(event: Record<string, unknown>): Promise<void> {
    this.assertAvailable("emit");
    const tenantId = stringField(event["tenantId"]) || stringField(event["organisationId"]) || null;
    await this.recordAudit(
      stringField(event["action"], "audit.event"),
      tenantId,
      stringField(event["resourceId"]),
      event
    );
    this.metric("audit_events_total", { operation: "emit" });
  }
}

export class InMemorySessionStore extends InMemorySemanticProviderBase implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(options: SemanticProviderRuntimeOptions = {}) {
    super("in-memory-session-store", options);
  }

  override reset(): void {
    super.reset();
    this.sessions.clear();
  }

  async create(command: CreateSessionCommand): Promise<string> {
    this.assertAvailable("create");
    const sessionId = this.nextId("session");
    const now = new Date();
    this.sessions.set(sessionId, {
      sessionId,
      userId: command.userId,
      tenantId: command.tenantId,
      organisationId: command.organisationId,
      roles: command.roles,
      permissions: command.permissions,
      displayName: command.displayName,
      expiresAt: new Date(now.getTime() + command.ttlSeconds * 1000),
      createdAt: now,
      ...(command.supportMode ? { supportMode: command.supportMode } : {}),
      ...(command.effectiveOrganisationId
        ? { effectiveOrganisationId: command.effectiveOrganisationId }
        : {}),
      ...(command.supportAccessReason ? { supportAccessReason: command.supportAccessReason } : {}),
      ...(command.accessTokenEnc ? { accessTokenEnc: command.accessTokenEnc } : {}),
      ...(command.refreshTokenEnc ? { refreshTokenEnc: command.refreshTokenEnc } : {}),
      ...(command.accessTokenExpiresAt
        ? { accessTokenExpiresAt: command.accessTokenExpiresAt }
        : {}),
      ...(command.idTokenEnc ? { idTokenEnc: command.idTokenEnc } : {}),
    });
    await this.recordAudit("session.created", command.organisationId, sessionId);
    this.metric("session_store_total", { operation: "create" });
    return sessionId;
  }

  async find(sessionId: string): Promise<SessionRecord | null> {
    this.assertAvailable("find");
    const record = this.sessions.get(sessionId) ?? null;
    if (record && record.expiresAt.getTime() <= Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    return record;
  }

  async refresh(sessionId: string, ttlSeconds: number): Promise<void> {
    this.assertAvailable("refresh");
    const record = this.sessions.get(sessionId);
    if (record) record.expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  }

  async destroy(sessionId: string): Promise<void> {
    this.assertAvailable("destroy");
    const tenantId = this.sessions.get(sessionId)?.organisationId ?? null;
    this.sessions.delete(sessionId);
    await this.recordAudit("session.destroyed", tenantId, sessionId);
  }
}

export class InMemoryAuthStateStore extends InMemorySemanticProviderBase {
  private readonly states = new Map<string, { payload: AuthStatePayload; expiresAt: number }>();

  constructor(options: SemanticProviderRuntimeOptions = {}) {
    super("in-memory-auth-state-store", options);
  }

  override reset(): void {
    super.reset();
    this.states.clear();
  }

  async put(state: string, payload: AuthStatePayload, ttlSeconds = 300): Promise<void> {
    this.assertAvailable("put");
    this.states.set(state, { payload, expiresAt: Date.now() + ttlSeconds * 1000 });
    this.metric("auth_state_total", { operation: "put" });
  }

  async take(state: string): Promise<AuthStatePayload | null> {
    this.assertAvailable("take");
    const entry = this.states.get(state);
    this.states.delete(state);
    if (!entry || entry.expiresAt <= Date.now()) return null;
    this.metric("auth_state_total", { operation: "take" });
    return entry.payload;
  }
}

export class InMemoryIdentityRepository
  extends InMemorySemanticProviderBase
  implements IdentityRepository
{
  private readonly users = new Map<string, User>();
  private readonly identities = new Map<string, ExternalIdentity & { userId: string }>();
  private readonly memberships = new Map<string, Membership & { role: TenantRole }>();

  constructor(options: SemanticProviderRuntimeOptions = {}) {
    super("in-memory-identity-repository", options);
    this.seedTenant("org-fixture", "admin@example.test", "Fixture Admin", "tenant-admin");
  }

  override reset(): void {
    super.reset();
    this.users.clear();
    this.identities.clear();
    this.memberships.clear();
  }

  seedTenant(organisationId: string, email: string, displayName: string, role: TenantRole): void {
    const userId = `${this.seed}:user:${email}`;
    const user = { id: userId, email, displayName } as User;
    this.users.set(userId, user);
    this.identities.set("fixture::" + userId, {
      id: `${this.seed}:external:${email}`,
      userId,
      provider: "fixture",
      providerSubject: userId,
      email,
    } as ExternalIdentity & { userId: string });
    this.memberships.set(userId, {
      id: `${this.seed}:membership:${email}`,
      userId,
      organisationId,
      role,
    } as Membership & { role: TenantRole });
  }

  async findExternalIdentity(provider: string, providerSubject: string) {
    this.assertAvailable("findExternalIdentity");
    const ext = this.identities.get(`${provider}::${providerSubject}`);
    if (!ext) return null;
    const user = this.users.get(ext.userId);
    return user ? { user, externalIdentity: ext } : null;
  }

  async createUserAndExternalIdentity(input: {
    email: string;
    displayName: string;
    provider: string;
    providerSubject: string;
  }) {
    this.assertAvailable("createUserAndExternalIdentity");
    const user = {
      id: this.nextId("user"),
      email: input.email.toLowerCase(),
      displayName: input.displayName,
    } as User;
    const externalIdentity = {
      id: this.nextId("external_identity"),
      userId: user.id,
      provider: input.provider,
      providerSubject: input.providerSubject,
      email: input.email.toLowerCase(),
    } as ExternalIdentity & { userId: string };
    this.users.set(user.id, user);
    this.identities.set(`${input.provider}::${input.providerSubject}`, externalIdentity);
    await this.recordAudit("identity.user_created", null, user.id);
    return { user, externalIdentity };
  }

  async findUserByEmail(email: string): Promise<User | null> {
    this.assertAvailable("findUserByEmail");
    const normalized = email.toLowerCase();
    return [...this.users.values()].find((u) => u.email.toLowerCase() === normalized) ?? null;
  }

  async linkExternalIdentity(
    userId: string,
    input: { provider: string; providerSubject: string; email: string }
  ): Promise<ExternalIdentity> {
    this.assertAvailable("linkExternalIdentity");
    const key = `${input.provider}::${input.providerSubject}`;
    const existing = this.identities.get(key);
    if (existing) return existing;
    const identity = {
      id: this.nextId("external_identity"),
      userId,
      provider: input.provider,
      providerSubject: input.providerSubject,
      email: input.email.toLowerCase(),
    } as ExternalIdentity & { userId: string };
    this.identities.set(key, identity);
    await this.recordAudit("identity.external_linked", null, userId);
    return identity;
  }

  async findMembershipByUser(userId: string): Promise<(Membership & { role: TenantRole }) | null> {
    this.assertAvailable("findMembershipByUser");
    return this.memberships.get(userId) ?? null;
  }

  async consumePendingInvitationsForUser(): Promise<
    Array<{ organisationId: string; role: TenantRole }>
  > {
    this.assertAvailable("consumePendingInvitationsForUser");
    return [];
  }
}

export class InMemoryOrganisationRepository
  extends InMemorySemanticProviderBase
  implements OrganisationRepository
{
  private readonly organisations = new Map<string, OrganisationProfile>();

  constructor(options: SemanticProviderRuntimeOptions = {}) {
    super("in-memory-organisation-repository", options);
    this.seedOrganisations();
  }

  override reset(): void {
    super.reset();
    this.organisations.clear();
    this.seedOrganisations();
  }

  private seedOrganisations(): void {
    const createdAt = "2026-01-01T00:00:00.000Z";
    this.organisations.set("org-fixture", {
      id: "org-fixture",
      slug: "semantic-dev",
      displayName: "Semantic Dev Tenant",
      createdAt,
      updatedAt: createdAt,
    });
    this.organisations.set("00000000-0000-4000-8000-000000000001", {
      id: "00000000-0000-4000-8000-000000000001",
      slug: "fixture-org",
      displayName: "Fixture Organisation",
      createdAt,
      updatedAt: createdAt,
    });
  }

  async getById(organisationId: string): Promise<OrganisationProfile | null> {
    this.assertAvailable("getById");
    return this.organisations.get(organisationId) ?? null;
  }

  async updateDisplayName(
    organisationId: string,
    displayName: string
  ): Promise<OrganisationProfile | null> {
    this.assertAvailable("updateDisplayName");
    const current = this.organisations.get(organisationId);
    if (!current) return null;
    const next = { ...current, displayName, updatedAt: new Date().toISOString() };
    this.organisations.set(organisationId, next);
    await this.recordAudit("organisation.updated", organisationId, organisationId);
    return next;
  }
}

export class InMemoryRateLimitRepository
  extends InMemorySemanticProviderBase
  implements RateLimitRepository
{
  private readonly policies = new Map<string, RateLimitPolicyRecord>();
  private readonly counters = new Map<string, number>();

  constructor(options: SemanticProviderRuntimeOptions = {}) {
    super("in-memory-rate-limit-repository", options);
  }

  override reset(): void {
    super.reset();
    this.policies.clear();
    this.counters.clear();
  }

  async getByKey(organisationId: string, policyKey: string): Promise<RateLimitPolicyRecord | null> {
    this.assertAvailable("getByKey");
    return this.policies.get(byTenantKey(organisationId, policyKey)) ?? null;
  }

  async listForTenant(organisationId: string): Promise<RateLimitPolicyRecord[]> {
    this.assertAvailable("listForTenant");
    return [...this.policies.entries()]
      .filter(([k]) => k.startsWith(`${organisationId}::`))
      .map(([, v]) => v);
  }

  listForTenantAsOperator(organisationId: string): Promise<RateLimitPolicyRecord[]> {
    return this.listForTenant(organisationId);
  }

  async upsert(input: UpsertRateLimitInput): Promise<void> {
    this.assertAvailable("upsert");
    const now = new Date().toISOString();
    this.policies.set(byTenantKey(input.organisationId, input.policyKey), {
      policyKey: input.policyKey,
      entitlementKey: input.entitlementKey,
      limit: input.limit,
      windowSeconds: input.windowSeconds,
      action: input.action,
      updatedAt: now,
      updatedBy: input.updatedBy,
    });
    await this.recordAudit("rate_limit.upserted", input.organisationId, input.policyKey);
  }

  async incrementAndCount(
    organisationId: string,
    policyKey: string,
    windowSeconds: number
  ): Promise<number> {
    this.assertAvailable("incrementAndCount");
    const key = `${organisationId}::${policyKey}::${Math.floor(Date.now() / 1000 / windowSeconds)}`;
    const count = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, count);
    this.metric("rate_limit_counter_total", { operation: "increment" });
    return count;
  }

  async currentCount(
    organisationId: string,
    policyKey: string,
    windowSeconds: number
  ): Promise<number> {
    this.assertAvailable("currentCount");
    const key = `${organisationId}::${policyKey}::${Math.floor(Date.now() / 1000 / windowSeconds)}`;
    return this.counters.get(key) ?? 0;
  }
}

type MutableEventRow = EventRow & {
  payload: Record<string, unknown>;
  idempotencyKey: string;
  nextAttemptAt: number;
};

export class InMemoryEventBus extends InMemorySemanticProviderBase implements EventBusPort {
  private readonly events = new Map<string, MutableEventRow>();
  private readonly idempotency = new Map<string, string>();
  private readonly deadLetters = new Map<
    string,
    DeadLetterRow & { payload: Record<string, unknown>; idempotencyKey: string }
  >();

  constructor(options: SemanticProviderRuntimeOptions = {}) {
    super("in-memory-event-bus", options);
  }

  override reset(): void {
    super.reset();
    this.events.clear();
    this.idempotency.clear();
    this.deadLetters.clear();
  }

  async publish(input: PublishEventInput): Promise<{ published: boolean; deduplicated: boolean }> {
    this.assertAvailable("publish");
    const idem = `${input.organisationId}::${input.eventType}::${input.idempotencyKey}`;
    if (this.idempotency.has(idem)) return { published: false, deduplicated: true };
    const id = this.nextId("event");
    this.idempotency.set(idem, id);
    this.events.set(id, {
      id,
      organisationId: input.organisationId,
      eventType: input.eventType,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload ?? {},
      status: "pending",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      lastError: null,
      createdAt: new Date().toISOString(),
      processedAt: null,
      nextAttemptAt: Date.now(),
    });
    await this.recordAudit("event.published", input.organisationId, id);
    return { published: true, deduplicated: false };
  }

  async claimBatch(limit: number): Promise<ClaimedEvent[]> {
    this.assertAvailable("claimBatch");
    const now = Date.now();
    const rows = [...this.events.values()]
      .filter((e) => e.status === "pending" && e.nextAttemptAt <= now)
      .slice(0, limit);
    for (const row of rows) row.status = "processing";
    return rows.map((row) => ({
      id: row.id,
      organisationId: row.organisationId,
      eventType: row.eventType,
      idempotencyKey: row.idempotencyKey,
      payload: row.payload,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
    }));
  }

  async markProcessed(eventId: string): Promise<void> {
    this.assertAvailable("markProcessed");
    const row = this.events.get(eventId);
    if (row) {
      row.status = "processed";
      row.processedAt = new Date().toISOString();
      await this.recordAudit("event.processed", row.organisationId, eventId);
    }
  }

  async recordFailure(eventId: string, error: string): Promise<"retry" | "dead_lettered"> {
    this.assertAvailable("recordFailure");
    const row = this.events.get(eventId);
    if (!row) return "dead_lettered";
    row.attempts += 1;
    row.lastError = error;
    if (row.attempts >= row.maxAttempts) {
      row.status = "dead_lettered";
      const deadId = this.nextId("dead_event");
      this.deadLetters.set(deadId, {
        id: deadId,
        eventId: row.id,
        organisationId: row.organisationId,
        eventType: row.eventType,
        attempts: row.attempts,
        lastError: error,
        deadAt: new Date().toISOString(),
        redrivenAt: null,
        payload: row.payload,
        idempotencyKey: row.idempotencyKey,
      });
      await this.recordAudit("event.dead_lettered", row.organisationId, row.id);
      return "dead_lettered";
    }
    row.status = "pending";
    row.nextAttemptAt = Date.now() + 100;
    return "retry";
  }

  async listEvents(organisationId: string, limit: number): Promise<EventRow[]> {
    this.assertAvailable("listEvents");
    return [...this.events.values()]
      .filter((e) => e.organisationId === organisationId)
      .slice(0, limit);
  }

  async listDeadLetters(organisationId: string, limit: number): Promise<DeadLetterRow[]> {
    this.assertAvailable("listDeadLetters");
    return [...this.deadLetters.values()]
      .filter((d) => d.organisationId === organisationId)
      .slice(0, limit);
  }

  async redrive(deadLetterId: string): Promise<{ eventId: string } | null> {
    this.assertAvailable("redrive");
    const dead = this.deadLetters.get(deadLetterId);
    if (!dead || dead.redrivenAt) return null;
    dead.redrivenAt = new Date().toISOString();
    const id = this.nextId("event");
    this.events.set(id, {
      id,
      organisationId: dead.organisationId,
      eventType: dead.eventType,
      idempotencyKey: `${dead.idempotencyKey}:redrive:${deadLetterId}`,
      payload: dead.payload,
      status: "pending",
      attempts: 0,
      maxAttempts: Math.max(1, dead.attempts),
      lastError: null,
      createdAt: new Date().toISOString(),
      processedAt: null,
      nextAttemptAt: Date.now(),
    });
    await this.recordAudit("event.redriven", dead.organisationId, id, { deadLetterId });
    return { eventId: id };
  }
}

export class InMemoryWorkerRegistry
  extends InMemorySemanticProviderBase
  implements WorkerRegistryPort
{
  private readonly workers = new Map<string, WorkerRecord>();

  constructor(options: SemanticProviderRuntimeOptions = {}) {
    super("in-memory-worker-registry", options);
  }

  override reset(): void {
    super.reset();
    this.workers.clear();
  }

  async heartbeat(workerId: string, workerKind: string, status = "alive"): Promise<void> {
    this.assertAvailable("heartbeat");
    this.workers.set(workerId, {
      workerId,
      workerKind,
      status,
      lastHeartbeatAt: new Date().toISOString(),
    });
  }

  async listWorkers(): Promise<WorkerRecord[]> {
    this.assertAvailable("listWorkers");
    return [...this.workers.values()];
  }
}

export class InMemorySecretStore extends InMemorySemanticProviderBase implements SecretStore {
  private readonly secrets = new Map<
    string,
    SecretMetadata & { organisationId: string; value: string }
  >();
  private readonly byName = new Map<string, string>();

  constructor(options: SemanticProviderRuntimeOptions = {}) {
    super("in-memory-secret-store", options);
  }

  override reset(): void {
    super.reset();
    this.secrets.clear();
    this.byName.clear();
  }

  async put(input: PutSecretInput): Promise<SecretMetadata> {
    this.assertAvailable("put");
    const nameKey = byTenantKey(input.organisationId, input.name);
    const existingRef = this.byName.get(nameKey);
    const now = new Date().toISOString();
    const ref = existingRef ?? `secret:${this.nextId("memory_secret")}`;
    const current = existingRef ? this.secrets.get(existingRef) : undefined;
    const meta: SecretMetadata & { organisationId: string; value: string } = {
      ref,
      name: input.name,
      provider: "builtin",
      version: (current?.version ?? 0) + 1,
      revoked: false,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      revokedAt: null,
      organisationId: input.organisationId,
      value: input.value,
    };
    this.secrets.set(ref, meta);
    this.byName.set(nameKey, ref);
    await this.recordAudit("secret.put", input.organisationId, ref, {
      name: input.name,
      version: meta.version,
    });
    return stripSecretValue(meta);
  }

  async getMetadata(organisationId: string, ref: string): Promise<SecretMetadata | null> {
    this.assertAvailable("getMetadata");
    const meta = this.secrets.get(ref);
    return meta?.organisationId === organisationId ? stripSecretValue(meta) : null;
  }

  async list(organisationId: string): Promise<SecretMetadata[]> {
    this.assertAvailable("list");
    return [...this.secrets.values()]
      .filter((s) => s.organisationId === organisationId)
      .map(stripSecretValue);
  }

  async resolve(organisationId: string, ref: string): Promise<string | null> {
    this.assertAvailable("resolve");
    const secret = this.secrets.get(ref);
    if (!secret || secret.organisationId !== organisationId || secret.revoked) return null;
    return secret.value;
  }

  async revoke(organisationId: string, ref: string, actorId: string): Promise<boolean> {
    this.assertAvailable("revoke");
    const secret = this.secrets.get(ref);
    if (!secret || secret.organisationId !== organisationId) return false;
    secret.revoked = true;
    secret.revokedAt = new Date().toISOString();
    secret.updatedAt = secret.revokedAt;
    await this.recordAudit("secret.revoked", organisationId, ref, { actorId });
    return true;
  }

  async delete(organisationId: string, ref: string, actorId: string): Promise<boolean> {
    this.assertAvailable("delete");
    const secret = this.secrets.get(ref);
    if (!secret || secret.organisationId !== organisationId) return false;
    this.secrets.delete(ref);
    this.byName.delete(byTenantKey(organisationId, secret.name));
    await this.recordAudit("secret.deleted", organisationId, ref, { actorId });
    return true;
  }

  async readiness(): Promise<SecretStoreReadiness> {
    const health = this.healthCheck();
    return {
      provider: "builtin",
      status: health.status === "ready" ? "ready" : "degraded",
      detail: health.detail,
    };
  }
}

function stripSecretValue(
  input: SecretMetadata & { value?: string; organisationId?: string }
): SecretMetadata {
  return {
    ref: input.ref,
    name: input.name,
    provider: input.provider,
    version: input.version,
    revoked: input.revoked,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    revokedAt: input.revokedAt,
  };
}

export class InMemoryStorageObjectRepository
  extends InMemorySemanticProviderBase
  implements StorageObjectRepository
{
  private readonly objects = new Map<string, StorageObjectRecord>();

  constructor(options: SemanticProviderRuntimeOptions = {}) {
    super("in-memory-storage-object-repository", options);
  }

  override reset(): void {
    super.reset();
    this.objects.clear();
  }

  async listForTenant(organisationId: string): Promise<StorageObjectRecord[]> {
    this.assertAvailable("listForTenant");
    return [...this.objects.values()].filter((o) => o.organisationId === organisationId);
  }

  async get(organisationId: string, objectKey: string): Promise<StorageObjectRecord | null> {
    this.assertAvailable("get");
    return this.objects.get(byTenantKey(organisationId, objectKey)) ?? null;
  }

  async create(input: CreateStorageObjectInput): Promise<StorageObjectRecord> {
    this.assertAvailable("create");
    const now = new Date().toISOString();
    const record: StorageObjectRecord = {
      objectId: this.nextId("object"),
      organisationId: input.organisationId,
      objectKey: input.objectKey,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      scanState: "uploaded",
      createdAt: now,
      updatedAt: now,
    };
    this.objects.set(byTenantKey(input.organisationId, input.objectKey), record);
    await this.recordAudit("storage.object.created", input.organisationId, input.objectKey, {
      createdBy: input.createdBy,
    });
    return record;
  }

  async setScanState(
    organisationId: string,
    objectKey: string,
    state: StorageObjectScanState
  ): Promise<StorageObjectRecord> {
    this.assertAvailable("setScanState");
    const key = byTenantKey(organisationId, objectKey);
    const record = this.objects.get(key);
    if (!record) throw new Error("storage_object_not_found");
    record.scanState = state;
    record.updatedAt = new Date().toISOString();
    await this.recordAudit("storage.object.scan_state", organisationId, objectKey, { state });
    return record;
  }

  async delete(organisationId: string, objectKey: string): Promise<void> {
    this.assertAvailable("delete");
    this.objects.delete(byTenantKey(organisationId, objectKey));
    await this.recordAudit("storage.object.deleted", organisationId, objectKey);
  }
}

export class InMemoryAntivirus extends InMemorySemanticProviderBase implements AntivirusPort {
  constructor(options: SemanticProviderRuntimeOptions = {}) {
    super("in-memory-antivirus", options);
  }

  async scan(
    input: AntivirusScanInput
  ): Promise<{ verdict: "clean" | "rejected"; reason?: string }> {
    this.assertAvailable("scan");
    this.trace("scan", { objectKey: input.objectKey, sizeBytes: input.body.length });
    this.metric("antivirus_scans_total", { operation: "scan" });
    if (input.body.toString("utf8").includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) {
      await this.recordAudit("antivirus.rejected", null, input.objectKey);
      return { verdict: "rejected", reason: "eicar_test_signature" };
    }
    await this.recordAudit("antivirus.clean", null, input.objectKey);
    return { verdict: "clean" };
  }
}

interface NotificationLogRow extends LogDispatchInput {
  at: string;
}

export class InMemoryNotificationRepository
  extends InMemorySemanticProviderBase
  implements NotificationRepository
{
  private readonly preferences = new Map<string, PreferenceRecord[]>();
  private readonly logRows: NotificationLogRow[] = [];

  constructor(options: SemanticProviderRuntimeOptions = {}) {
    super("in-memory-notification-repository", options);
  }

  override reset(): void {
    super.reset();
    this.preferences.clear();
    this.logRows.length = 0;
  }

  async listPreferences(organisationId: string, userId: string): Promise<PreferenceRecord[]> {
    this.assertAvailable("listPreferences");
    return [...(this.preferences.get(byTenantKey(organisationId, userId)) ?? [])];
  }

  listPreferencesAsOperator(organisationId: string, userId: string): Promise<PreferenceRecord[]> {
    return this.listPreferences(organisationId, userId);
  }

  async upsertPreferences(input: UpsertPreferenceInput): Promise<void> {
    this.assertAvailable("upsertPreferences");
    this.preferences.set(byTenantKey(input.organisationId, input.userId), [...input.preferences]);
    await this.recordAudit(
      "notification.preferences.upserted",
      input.organisationId,
      input.userId,
      { count: input.preferences.length }
    );
  }

  async logDispatch(input: LogDispatchInput): Promise<void> {
    this.assertAvailable("logDispatch");
    this.logRows.push({ ...input, at: new Date().toISOString() });
    await this.recordAudit("notification.dispatched", input.organisationId, input.userId, {
      channel: input.channel,
      status: input.status,
    });
  }

  async countLog(organisationId: string, userId: string): Promise<number> {
    this.assertAvailable("countLog");
    return this.logRows.filter((r) => r.organisationId === organisationId && r.userId === userId)
      .length;
  }
}

export function createInMemoryNotificationTransport(
  provider = new InMemorySemanticProviderBase("in-memory-notification-transport")
): NotificationTransport {
  return async (msg) => {
    provider["assertAvailable"]?.("send");
    await provider["recordAudit"]?.("notification.transport.sent", msg.organisationId, msg.userId, {
      channel: msg.channel,
      category: msg.category,
    });
    return "sent";
  };
}

interface MutableWebhookDelivery extends WebhookDeliveryRecord {
  organisationId: string;
  subscriptionId: string;
  payload: string | null;
  nextAttemptAt: Date | null;
}

export class InMemoryWebhookStore extends InMemorySemanticProviderBase implements WebhookStore {
  private readonly subscriptions = new Map<
    string,
    WebhookSubscriptionRecord & { organisationId: string; secret: string }
  >();
  private readonly deliveries = new Map<string, MutableWebhookDelivery>();

  constructor(options: SemanticProviderRuntimeOptions = {}) {
    super("in-memory-webhook-store", options);
  }

  override reset(): void {
    super.reset();
    this.subscriptions.clear();
    this.deliveries.clear();
  }

  async list(organisationId: string): Promise<WebhookSubscriptionRecord[]> {
    this.assertAvailable("list");
    return [...this.subscriptions.values()]
      .filter((s) => s.organisationId === organisationId)
      .map(stripWebhookSecret);
  }

  async get(organisationId: string, id: string): Promise<WebhookSubscriptionRecord | null> {
    this.assertAvailable("get");
    const sub = this.subscriptions.get(id);
    return sub?.organisationId === organisationId ? stripWebhookSecret(sub) : null;
  }

  async create(input: CreateWebhookInput): Promise<WebhookSubscriptionRecord> {
    this.assertAvailable("create");
    const now = new Date().toISOString();
    const record = {
      id: this.nextId("webhook"),
      url: input.url,
      enabled: input.enabled,
      eventTypes: input.eventTypes,
      hasSecret: input.secret.length > 0,
      createdAt: now,
      updatedAt: now,
      organisationId: input.organisationId,
      secret: input.secret,
    };
    this.subscriptions.set(record.id, record);
    await this.recordAudit("webhook.created", input.organisationId, record.id);
    return stripWebhookSecret(record);
  }

  async update(
    organisationId: string,
    id: string,
    fields: Partial<Pick<WebhookSubscriptionRecord, "url" | "enabled" | "eventTypes">>
  ): Promise<WebhookSubscriptionRecord | null> {
    this.assertAvailable("update");
    const sub = this.subscriptions.get(id);
    if (!sub || sub.organisationId !== organisationId) return null;
    Object.assign(sub, fields, { updatedAt: new Date().toISOString() });
    await this.recordAudit("webhook.updated", organisationId, id);
    return stripWebhookSecret(sub);
  }

  async delete(organisationId: string, id: string): Promise<boolean> {
    this.assertAvailable("delete");
    const sub = this.subscriptions.get(id);
    if (!sub || sub.organisationId !== organisationId) return false;
    this.subscriptions.delete(id);
    await this.recordAudit("webhook.deleted", organisationId, id);
    return true;
  }

  async rotateSecret(organisationId: string, id: string, secret: string): Promise<boolean> {
    this.assertAvailable("rotateSecret");
    const sub = this.subscriptions.get(id);
    if (!sub || sub.organisationId !== organisationId) return false;
    sub.secret = secret;
    sub.hasSecret = secret.length > 0;
    sub.updatedAt = new Date().toISOString();
    await this.recordAudit("webhook.secret_rotated", organisationId, id);
    return true;
  }

  async getSecret(organisationId: string, id: string): Promise<string | null> {
    this.assertAvailable("getSecret");
    const sub = this.subscriptions.get(id);
    return sub?.organisationId === organisationId ? sub.secret : null;
  }

  async recordDelivery(input: RecordDeliveryInput): Promise<void> {
    this.assertAvailable("recordDelivery");
    const id = this.nextId("webhook_delivery");
    this.deliveries.set(id, {
      id,
      event: input.event,
      status: input.status,
      responseStatus: input.responseStatus,
      attempt: input.attempt,
      error: input.error,
      createdAt: new Date().toISOString(),
      organisationId: input.organisationId,
      subscriptionId: input.subscriptionId,
      payload: null,
      nextAttemptAt: null,
    });
  }

  async listDeliveries(
    organisationId: string,
    subscriptionId: string,
    limit: number
  ): Promise<WebhookDeliveryRecord[]> {
    this.assertAvailable("listDeliveries");
    return [...this.deliveries.values()]
      .filter((d) => d.organisationId === organisationId && d.subscriptionId === subscriptionId)
      .slice(0, limit)
      .map(stripDeliveryPrivate);
  }

  async counts(organisationId: string): Promise<{ total: number; enabled: number }> {
    this.assertAvailable("counts");
    const subs = [...this.subscriptions.values()].filter(
      (s) => s.organisationId === organisationId
    );
    return { total: subs.length, enabled: subs.filter((s) => s.enabled).length };
  }

  async enqueueDelivery(input: {
    organisationId: string;
    subscriptionId: string;
    event: WebhookDeliveryRecord["event"];
    payload: string;
  }): Promise<void> {
    this.assertAvailable("enqueueDelivery");
    const id = this.nextId("webhook_delivery");
    this.deliveries.set(id, {
      id,
      organisationId: input.organisationId,
      subscriptionId: input.subscriptionId,
      event: input.event,
      payload: input.payload,
      status: "pending",
      responseStatus: null,
      attempt: 0,
      error: null,
      createdAt: new Date().toISOString(),
      nextAttemptAt: new Date(0),
    });
  }

  async claimDueDeliveries(limit: number, now: Date): Promise<ClaimedDelivery[]> {
    this.assertAvailable("claimDueDeliveries");
    const rows = [...this.deliveries.values()]
      .filter((d) => d.status === "pending" && (d.nextAttemptAt?.getTime() ?? 0) <= now.getTime())
      .slice(0, limit);
    return rows.map((d) => ({
      id: d.id,
      organisationId: d.organisationId,
      subscriptionId: d.subscriptionId,
      event: d.event,
      payload: d.payload,
      attempt: d.attempt,
    }));
  }

  async markDeliveryResult(id: string, result: DeliveryResult): Promise<void> {
    this.assertAvailable("markDeliveryResult");
    const row = this.deliveries.get(id);
    if (!row) return;
    row.status = result.status === "processing" ? "pending" : result.status;
    row.responseStatus = result.responseStatus;
    row.attempt = result.attempt;
    row.error = result.error;
    row.nextAttemptAt = result.nextAttemptAt;
  }

  async subscriptionMetrics(
    organisationId: string,
    subscriptionId: string
  ): Promise<DeliveryMetrics> {
    this.assertAvailable("subscriptionMetrics");
    const rows = [...this.deliveries.values()].filter(
      (d) => d.organisationId === organisationId && d.subscriptionId === subscriptionId
    );
    const last = rows.at(-1);
    return {
      total: rows.length,
      delivered: rows.filter((d) => d.status === "delivered").length,
      failed: rows.filter((d) => d.status === "failed").length,
      dead: rows.filter((d) => d.status === "dead").length,
      pending: rows.filter((d) => d.status === "pending").length,
      lastStatus: last?.status ?? null,
      lastDeliveryAt: last?.createdAt ?? null,
      lastSuccessAt: [...rows].reverse().find((d) => d.status === "delivered")?.createdAt ?? null,
      lastFailureAt:
        [...rows].reverse().find((d) => d.status === "failed" || d.status === "dead")?.createdAt ??
        null,
    };
  }

  async deadDeliveryCount(organisationId: string): Promise<number> {
    this.assertAvailable("deadDeliveryCount");
    return [...this.deliveries.values()].filter(
      (d) => d.organisationId === organisationId && d.status === "dead"
    ).length;
  }

  async redriveDeadDelivery(organisationId: string, deliveryId: string): Promise<boolean> {
    this.assertAvailable("redriveDeadDelivery");
    const row = this.deliveries.get(deliveryId);
    if (!row || row.organisationId !== organisationId || row.status !== "dead") return false;
    row.status = "pending";
    row.attempt = 0;
    row.nextAttemptAt = new Date(0);
    return true;
  }

  async redriveDeadForSubscription(
    organisationId: string,
    subscriptionId: string
  ): Promise<number> {
    this.assertAvailable("redriveDeadForSubscription");
    let count = 0;
    for (const row of this.deliveries.values()) {
      if (
        row.organisationId === organisationId &&
        row.subscriptionId === subscriptionId &&
        row.status === "dead"
      ) {
        row.status = "pending";
        row.attempt = 0;
        row.nextAttemptAt = new Date(0);
        count += 1;
      }
    }
    return count;
  }
}

function stripWebhookSecret(
  input: WebhookSubscriptionRecord & { secret?: string; organisationId?: string }
): WebhookSubscriptionRecord {
  return {
    id: input.id,
    url: input.url,
    enabled: input.enabled,
    eventTypes: input.eventTypes,
    hasSecret: input.hasSecret,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function stripDeliveryPrivate(input: MutableWebhookDelivery): WebhookDeliveryRecord {
  return {
    id: input.id,
    event: input.event,
    status: input.status,
    responseStatus: input.responseStatus,
    attempt: input.attempt,
    error: input.error,
    createdAt: input.createdAt,
  };
}

export class InMemoryWebhookDispatcher
  extends InMemorySemanticProviderBase
  implements WebhookDispatchPort
{
  readonly deliveries: WebhookDispatchRequest[] = [];

  constructor(options: SemanticProviderRuntimeOptions = {}) {
    super("in-memory-webhook-dispatcher", options);
  }

  override reset(): void {
    super.reset();
    this.deliveries.length = 0;
  }

  async dispatch(req: WebhookDispatchRequest): Promise<WebhookDispatchResult> {
    this.assertAvailable("dispatch");
    this.deliveries.push(req);
    await this.recordAudit("webhook.dispatched", null, req.url, { bytes: req.body.length });
    return {
      ok: !req.url.includes("fail"),
      status: req.url.includes("fail") ? 500 : 202,
      error: req.url.includes("fail") ? "injected destination failure" : null,
    };
  }
}

export class InMemorySearchRepository
  extends InMemorySemanticProviderBase
  implements SearchIndexPort, SearchQueryPort
{
  private readonly docs = new Map<string, SearchDocumentInput>();

  constructor(options: SemanticProviderRuntimeOptions = {}) {
    super("in-memory-search-repository", options);
  }

  override reset(): void {
    super.reset();
    this.docs.clear();
  }

  async index(input: SearchDocumentInput): Promise<void> {
    this.assertAvailable("index");
    this.docs.set(`${input.organisationId}::${input.documentType}::${input.documentId}`, {
      ...input,
    });
    await this.recordAudit("search.indexed", input.organisationId, input.documentId);
  }

  async remove(organisationId: string, documentType: string, documentId: string): Promise<boolean> {
    this.assertAvailable("remove");
    return this.docs.delete(`${organisationId}::${documentType}::${documentId}`);
  }

  async reindex(organisationId: string): Promise<number> {
    this.assertAvailable("reindex");
    return [...this.docs.values()].filter((d) => d.organisationId === organisationId).length;
  }

  async countAll(): Promise<number> {
    this.assertAvailable("countAll");
    return this.docs.size;
  }

  async search(organisationId: string, input: SearchQueryInput): Promise<SearchQueryResult> {
    this.assertAvailable("search");
    const terms = input.q.toLowerCase().split(/\s+/).filter(Boolean);
    const page = input.page ?? 1;
    const limit = input.limit ?? 20;
    const matches = [...this.docs.values()]
      .filter((d) => d.organisationId === organisationId)
      .filter((d) => !input.documentType || d.documentType === input.documentType)
      .filter((d) => !d.permissionKey || input.permissions.includes(d.permissionKey))
      .map((d) => {
        const haystack = `${d.title} ${d.body}`.toLowerCase();
        const score = terms.reduce((acc, term) => acc + (haystack.includes(term) ? 1 : 0), 0);
        return { d, score };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score);
    return {
      hits: matches.slice((page - 1) * limit, page * limit).map(({ d, score }) => ({
        documentId: d.documentId,
        documentType: d.documentType,
        title: d.title,
        url: d.url ?? null,
        score,
      })),
      total: matches.length,
    };
  }
}

export class InMemoryObservabilityRepository
  extends InMemorySemanticProviderBase
  implements MetricRepository, AlertRepository, IncidentRepository
{
  private readonly signals = new Map<string, MetricSignalRecord & { organisationId: string }>();
  private readonly samples = new Map<string, number>();
  private readonly rules = new Map<string, AlertRuleRecord & { organisationId: string }>();
  private readonly incidents = new Map<string, IncidentRecord & { organisationId: string }>();

  constructor(options: SemanticProviderRuntimeOptions = {}) {
    super("in-memory-observability-repository", options);
  }

  override reset(): void {
    super.reset();
    this.signals.clear();
    this.samples.clear();
    this.rules.clear();
    this.incidents.clear();
  }

  async registerSignal(input: RegisterSignalInput): Promise<void> {
    this.assertAvailable("registerSignal");
    const key = byTenantKey(input.organisationId, input.signalKey);
    this.signals.set(key, {
      organisationId: input.organisationId,
      signalKey: input.signalKey,
      displayName: input.displayName,
      unit: input.unit ?? "count",
      kind: input.kind ?? "counter",
      description: input.description ?? "",
      latestValue: this.samples.get(key) ?? null,
    });
  }

  async listSignals(organisationId: string): Promise<MetricSignalRecord[]> {
    this.assertAvailable("listSignals");
    return [...this.signals.values()].filter((s) => s.organisationId === organisationId);
  }

  listSignalsAsOperator(organisationId: string): Promise<MetricSignalRecord[]> {
    return this.listSignals(organisationId);
  }

  async recordSample(organisationId: string, signalKey: string, value: number): Promise<void> {
    this.assertAvailable("recordSample");
    const key = byTenantKey(organisationId, signalKey);
    this.samples.set(key, value);
    const signal = this.signals.get(key);
    if (signal) signal.latestValue = value;
    await this.recordAudit("observability.sample_recorded", organisationId, signalKey, { value });
  }

  async latestValue(organisationId: string, signalKey: string): Promise<number | null> {
    this.assertAvailable("latestValue");
    return this.samples.get(byTenantKey(organisationId, signalKey)) ?? null;
  }

  async countSignals(): Promise<number> {
    this.assertAvailable("countSignals");
    return this.signals.size;
  }

  async upsertRule(input: UpsertAlertRuleInput): Promise<void> {
    this.assertAvailable("upsertRule");
    const id = byTenantKey(input.organisationId, input.ruleKey);
    this.rules.set(id, {
      id,
      ruleKey: input.ruleKey,
      signalKey: input.signalKey,
      comparator: input.comparator,
      threshold: input.threshold,
      severity: input.severity,
      enabled: input.enabled,
      notifyUserId: input.notifyUserId ?? null,
      notifyCategory: input.notifyCategory,
      updatedAt: new Date().toISOString(),
      updatedBy: input.updatedBy,
      organisationId: input.organisationId,
    });
  }

  async listRules(organisationId: string): Promise<AlertRuleRecord[]> {
    this.assertAvailable("listRules");
    return [...this.rules.values()].filter((r) => r.organisationId === organisationId);
  }

  listRulesAsOperator(organisationId: string): Promise<AlertRuleRecord[]> {
    return this.listRules(organisationId);
  }

  async findRuleById(
    ruleId: string
  ): Promise<(AlertRuleRecord & { organisationId: string }) | null> {
    this.assertAvailable("findRuleById");
    return this.rules.get(ruleId) ?? null;
  }

  async open(input: OpenIncidentInput): Promise<IncidentRecord> {
    this.assertAvailable("open");
    const incident = {
      id: this.nextId("incident"),
      ruleKey: input.ruleKey,
      title: input.title,
      severity: input.severity,
      status: "open",
      observedValue: input.observedValue,
      threshold: input.threshold,
      openedAt: new Date().toISOString(),
      acknowledgedAt: null,
      resolvedAt: null,
      organisationId: input.organisationId,
    } as IncidentRecord & { organisationId: string };
    this.incidents.set(incident.id, incident);
    return incident;
  }

  async listForTenant(organisationId: string): Promise<IncidentRecord[]> {
    this.assertAvailable("listForTenant");
    return [...this.incidents.values()].filter((i) => i.organisationId === organisationId);
  }

  listForTenantAsOperator(organisationId: string): Promise<IncidentRecord[]> {
    return this.listForTenant(organisationId);
  }

  async findById(
    incidentId: string
  ): Promise<(IncidentRecord & { organisationId: string }) | null> {
    this.assertAvailable("findById");
    return this.incidents.get(incidentId) ?? null;
  }

  async updateStatus(
    incidentId: string,
    status: IncidentRecord["status"],
    _updatedBy: string
  ): Promise<IncidentRecord | null> {
    this.assertAvailable("updateStatus");
    const incident = this.incidents.get(incidentId);
    if (!incident) return null;
    incident.status = status;
    if (status === "acknowledged") incident.acknowledgedAt = new Date().toISOString();
    if (status === "resolved") incident.resolvedAt = new Date().toISOString();
    return incident;
  }

  async countOpen(): Promise<number> {
    this.assertAvailable("countOpen");
    return [...this.incidents.values()].filter((i) => i.status === "open").length;
  }
}

export class InMemoryBackupRestoreProvider extends InMemorySemanticProviderBase {
  private readonly snapshots = new Map<
    string,
    { tenantId: string; createdAt: string; payload: unknown }
  >();

  constructor(options: SemanticProviderRuntimeOptions = {}) {
    super("in-memory-backup-restore-provider", options);
  }

  override reset(): void {
    super.reset();
    this.snapshots.clear();
  }

  async backupTenant(tenantId: string, payload: unknown): Promise<{ backupId: string }> {
    this.assertAvailable("backupTenant");
    const backupId = this.nextId("backup");
    this.snapshots.set(backupId, { tenantId, createdAt: new Date().toISOString(), payload });
    await this.recordAudit("backup.created", tenantId, backupId);
    return { backupId };
  }

  async restoreTenant(
    tenantId: string,
    backupId: string
  ): Promise<{ restored: boolean; payload: unknown }> {
    this.assertAvailable("restoreTenant");
    const snapshot = this.snapshots.get(backupId);
    if (!snapshot || snapshot.tenantId !== tenantId) return { restored: false, payload: null };
    await this.recordAudit("backup.restored", tenantId, backupId);
    return { restored: true, payload: snapshot.payload };
  }
}

export const semanticDevProviderInventory = [
  {
    provider: "postgres-identity-repository",
    classification: "needs in-memory adapter",
    devProvider: "in-memory-identity-repository",
  },
  {
    provider: "postgres repositories",
    classification: "needs in-memory adapter",
    devProvider: "in-memory repository family",
  },
  {
    provider: "redis session/auth/rate-limit",
    classification: "needs in-memory adapter",
    devProvider:
      "in-memory-session-store/in-memory-auth-state-store/in-memory-rate-limit-repository",
  },
  {
    provider: "s3/minio object storage",
    classification: "needs in-memory adapter",
    devProvider: "in-memory-object-storage + in-memory-storage-object-repository",
  },
  {
    provider: "clamav-antivirus",
    classification: "needs in-memory adapter",
    devProvider: "in-memory-antivirus",
  },
  {
    provider: "smtp/mailpit notification",
    classification: "needs in-memory adapter",
    devProvider: "in-memory-notification-transport",
  },
  {
    provider: "http-webhook-dispatcher",
    classification: "needs in-memory adapter",
    devProvider: "in-memory-webhook-dispatcher",
  },
  {
    provider: "openbao-secret-store",
    classification: "needs in-memory adapter",
    devProvider: "in-memory-secret-store",
  },
  {
    provider: "loki/prometheus/otel observability",
    classification: "needs in-memory adapter",
    devProvider: "in-memory-observability-repository",
  },
  {
    provider: "postgres-search-repository",
    classification: "needs in-memory adapter",
    devProvider: "in-memory-search-repository",
  },
  {
    provider: "lago-billing-provider",
    classification: "already in-memory",
    devProvider: "in-memory-billing-provider",
  },
  {
    provider: "temporal/windmill workflow automation",
    classification: "already in-memory",
    devProvider: "in-memory-workflow-orchestrator/in-memory-automation-runner",
  },
  {
    provider: "postgres-event-bus",
    classification: "needs in-memory adapter",
    devProvider: "in-memory-event-bus",
  },
  {
    provider: "pgbackrest backup/restore",
    classification: "needs in-memory adapter",
    devProvider: "in-memory-backup-restore-provider",
  },
  {
    provider: "caddy-local-routing-probe",
    classification: "should remain real in dev",
    justification:
      "routing probes assert browser/proxy integration and are explicitly opted into compose parity checks, not required by semantic-dev boot",
  },
  {
    provider: "static assurance/openapi/playwright validators",
    classification: "not a runtime dependency",
  },
] as const;
