// ---------------------------------------------------------------------------
// Environment registry usecase (ADR-0072 / ADR-ACT-0274).
//
// The application's canonical understanding of the deployment ladder. Non-secret
// intent is sourced from the tracked manifests config/environments/<stage>.json and
// projected into environment_registry; operational lifecycle (bootstrap/reconcile/
// provider-config status) is recorded here. Operator-only and audited.
//
// Hard rules (defence-in-depth — also enforced by the manifest validator and DB
// CHECK constraints):
//   - mocks are forbidden in staging/production;
//   - destructive operations are forbidden in staging/production;
//   - no secret value is ever stored here (secrets -> ADR-0069 store; bindings ->
//     provider_configs).
//
// Authorization: every operation requires a platform.environment.* permission. These
// are SYSTEM/OPERATOR permissions only — tenant admins never receive them.
// ---------------------------------------------------------------------------

import { ForbiddenError, ValidationError } from "@platform/platform-errors";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import type {
  BootstrapStatus,
  EnvironmentRecord,
  EnvironmentRegistryRepository,
  ProviderConfigStatus,
  UpsertEnvironmentInput,
} from "../ports/environment-registry-repository.ts";

export const ENVIRONMENT_PERMISSIONS = {
  read: "platform.environment.read",
  write: "platform.environment.write",
  operate: "platform.environment.operate",
  rotateSecret: "platform.environment.rotate_secret",
  bootstrap: "platform.environment.bootstrap",
} as const;

export interface EnvironmentActor {
  actorId: string;
  actorRoles: string[];
  actorPermissions: string[];
  sourceHost?: string;
}

export interface EnvironmentRegistryDeps {
  environments: EnvironmentRegistryRepository;
  audit: AuditEventPort;
}

/** A parsed, NON-SECRET environment manifest descriptor (config/environments/<stage>.json). */
export interface EnvironmentManifestDescriptor {
  environmentId: string;
  name: string;
  stage: EnvironmentRecord["stage"];
  executor: EnvironmentRecord["executor"];
  composeProject: string;
  baseUrl?: string | null;
  apiUrl?: string | null;
  domain?: string | null;
  allowedProfiles?: string[];
  allowedMocks?: string[];
  secretStoreProvider?: string;
  stagePolicy?: { destructiveAllowed?: boolean; dataPreservation?: string };
  temporaryMockException?: Record<string, unknown>;
  seededProviderDefaults?: unknown[];
  adminIdentity?: Record<string, unknown>;
}

function assertPermission(actor: EnvironmentActor, permission: string): void {
  if (!actor.actorPermissions?.includes(permission)) {
    throw new ForbiddenError("api.error.environmentPermissionDenied", {
      safeDetails: { required: permission },
    });
  }
}

function manifestToUpsert(m: EnvironmentManifestDescriptor): UpsertEnvironmentInput {
  const isProdLike = m.stage === "staging" || m.stage === "production";
  const allowedMocks = m.allowedMocks ?? [];
  // Defence-in-depth: mocks/destructive are forbidden in staging/production.
  if (isProdLike && allowedMocks.length > 0) {
    throw new ValidationError("api.error.environmentMocksForbidden", {
      safeDetails: { environmentId: m.environmentId, stage: m.stage },
    });
  }
  const destructiveAllowed = m.stagePolicy?.destructiveAllowed ?? false;
  if (isProdLike && destructiveAllowed) {
    throw new ValidationError("api.error.environmentDestructiveForbidden", {
      safeDetails: { environmentId: m.environmentId, stage: m.stage },
    });
  }
  const dataPreservation =
    m.stagePolicy?.dataPreservation === "ephemeral" ? "ephemeral" : "preserve";
  const metadata: Record<string, unknown> = {};
  if (m.temporaryMockException) metadata["temporaryMockException"] = m.temporaryMockException;
  if (m.seededProviderDefaults) metadata["seededProviderDefaults"] = m.seededProviderDefaults;
  if (m.adminIdentity) metadata["adminIdentity"] = m.adminIdentity;
  return {
    environmentId: m.environmentId,
    name: m.name,
    stage: m.stage,
    executor: m.executor,
    composeProject: m.composeProject,
    baseUrl: m.baseUrl ?? null,
    apiUrl: m.apiUrl ?? null,
    domain: m.domain ?? null,
    allowedProfiles: m.allowedProfiles ?? [],
    allowedMocks,
    mockPolicy: allowedMocks.length > 0 ? "mocks-allowed" : "no-mocks",
    destructiveAllowed,
    dataPreservation,
    secretStoreProvider: m.secretStoreProvider ?? "openbao",
    metadata,
  };
}

export async function listEnvironments(
  deps: EnvironmentRegistryDeps,
  actor: EnvironmentActor
): Promise<EnvironmentRecord[]> {
  assertPermission(actor, ENVIRONMENT_PERMISSIONS.read);
  return deps.environments.list();
}

export async function getEnvironment(
  deps: EnvironmentRegistryDeps,
  actor: EnvironmentActor,
  environmentId: string
): Promise<EnvironmentRecord | null> {
  assertPermission(actor, ENVIRONMENT_PERMISSIONS.read);
  return deps.environments.get(environmentId);
}

/** Register/refresh one environment from its manifest descriptor (audited). */
export async function registerEnvironment(
  deps: EnvironmentRegistryDeps,
  actor: EnvironmentActor,
  manifest: EnvironmentManifestDescriptor
): Promise<EnvironmentRecord> {
  assertPermission(actor, ENVIRONMENT_PERMISSIONS.write);
  const input = manifestToUpsert(manifest);
  await deps.audit.emit(
    createAuditEvent({
      actorId: actor.actorId,
      actorRoles: actor.actorRoles,
      tenantId: actor.actorId, // operator-global: no tenant; actor id stands in
      action: AuditAction.EnvironmentRegistered,
      resource: "environment",
      resourceId: input.environmentId,
      metadata: {
        stage: input.stage,
        executor: input.executor,
        mockPolicy: input.mockPolicy,
        destructiveAllowed: input.destructiveAllowed,
      },
      sourceHost: actor.sourceHost,
    })
  );
  return deps.environments.upsert(input);
}

/** Sync the whole ladder from manifests (idempotent). */
export async function syncEnvironmentsFromManifests(
  deps: EnvironmentRegistryDeps,
  actor: EnvironmentActor,
  manifests: EnvironmentManifestDescriptor[]
): Promise<EnvironmentRecord[]> {
  assertPermission(actor, ENVIRONMENT_PERMISSIONS.write);
  const out: EnvironmentRecord[] = [];
  for (const m of manifests) out.push(await registerEnvironment(deps, actor, m));
  return out;
}

/** Record a bootstrap transition (audited). Requires the bootstrap permission. */
export async function recordBootstrap(
  deps: EnvironmentRegistryDeps,
  actor: EnvironmentActor,
  environmentId: string,
  status: BootstrapStatus
): Promise<boolean> {
  assertPermission(actor, ENVIRONMENT_PERMISSIONS.bootstrap);
  await deps.audit.emit(
    createAuditEvent({
      actorId: actor.actorId,
      actorRoles: actor.actorRoles,
      tenantId: actor.actorId,
      action: AuditAction.EnvironmentBootstrapped,
      resource: "environment",
      resourceId: environmentId,
      metadata: { status },
      sourceHost: actor.sourceHost,
    })
  );
  return deps.environments.setBootstrapStatus(environmentId, status);
}

/** Record a reconcile pass (audited). Requires the operate permission. */
export async function recordReconcile(
  deps: EnvironmentRegistryDeps,
  actor: EnvironmentActor,
  environmentId: string
): Promise<boolean> {
  assertPermission(actor, ENVIRONMENT_PERMISSIONS.operate);
  await deps.audit.emit(
    createAuditEvent({
      actorId: actor.actorId,
      actorRoles: actor.actorRoles,
      tenantId: actor.actorId,
      action: AuditAction.EnvironmentReconciled,
      resource: "environment",
      resourceId: environmentId,
      sourceHost: actor.sourceHost,
    })
  );
  return deps.environments.markReconciled(environmentId);
}

/** Update the adapter-confirmed provider-config status. Requires operate. */
export async function setProviderConfigStatus(
  deps: EnvironmentRegistryDeps,
  actor: EnvironmentActor,
  environmentId: string,
  status: ProviderConfigStatus
): Promise<boolean> {
  assertPermission(actor, ENVIRONMENT_PERMISSIONS.operate);
  return deps.environments.setProviderConfigStatus(environmentId, status);
}
