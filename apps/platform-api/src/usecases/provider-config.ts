// ---------------------------------------------------------------------------
// Provider configuration usecase (ADR-0070 / ADR-ACT-0266) — Tier-1 kernel.
//
// The config plane that binds a USF capability to a concrete provider instance per
// environment, with credentials BY REFERENCE (secret:<uuid> into the ADR-0069 store).
// Operator-only; audited (audit-before-change). Validation enforces the hard rules:
//   - a credential is a secret-store ref, never a plaintext secret;
//   - config carries no secret-bearing keys (secrets go through credentialRef);
//   - a forbidden-in-production (mock) provider can never be active in production;
//   - a provider that requires a credential but has none is forced to `degraded`;
//   - lifecycle `ready` is ADAPTER-confirmed — config alone never implies ready.
// ---------------------------------------------------------------------------

import { ValidationError } from "@platform/platform-errors";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import type {
  ProviderConfigListResponse,
  ProviderConfigSummary,
  PutProviderConfigRequest,
} from "@platform/contracts-admin";
import type {
  ProviderConfigRecord,
  ProviderConfigRepository,
  ProviderLifecycleState,
} from "../ports/provider-config-repository.ts";

export interface ProviderConfigDeps {
  providers: ProviderConfigRepository;
  audit: AuditEventPort;
}

export interface ProviderConfigActor {
  actorId: string;
  actorRoles: string[];
  sourceHost?: string | undefined;
}

const SECRET_KEY = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;

function toSummary(r: ProviderConfigRecord): ProviderConfigSummary {
  return {
    id: r.id,
    providerKey: r.providerKey,
    capability: r.capability,
    environment: r.environment,
    instanceLabel: r.instanceLabel,
    // classification is validated to the enum on write (PutProviderConfigRequestSchema);
    // the store column is free TEXT, so narrow back to the contract enum here.
    classification: r.classification as ProviderConfigSummary["classification"],
    lifecycleState: r.lifecycleState,
    endpoint: r.endpoint,
    // credentialRef is an OPAQUE ref (not a secret) — safe to surface; hasCredential is
    // the convenient boolean. The plaintext value is never stored or returned anywhere.
    credentialRef: r.credentialRef,
    hasCredential: r.credentialRef != null,
    config: r.config,
    updatedAt: r.updatedAt,
    updatedBy: r.updatedBy,
  };
}

export async function listProviderConfigs(
  deps: ProviderConfigDeps,
  opts: { capability?: string } = {}
): Promise<ProviderConfigListResponse> {
  const rows = opts.capability
    ? await deps.providers.listForCapability(opts.capability)
    : await deps.providers.list();
  return { providers: rows.map(toSummary) };
}

/**
 * Derive the lifecycle state from the REQUESTED state + the validated facts. A
 * provider that requires a credential but has no secretRef can never be better than
 * `degraded`; `ready`/`configured` is only honoured when the credential requirement
 * is satisfied. `ready` proper is adapter-confirmed via deriveReadinessLifecycle.
 */
function deriveLifecycle(
  requested: ProviderLifecycleState,
  requiresCredential: boolean,
  hasCredentialRef: boolean
): ProviderLifecycleState {
  if (requested === "disabled" || requested === "candidate") return requested;
  if (requiresCredential && !hasCredentialRef) return "degraded";
  return requested;
}

/** Operator-only, audited provider-config upsert. Audit-before-change. */
export async function putProviderConfig(
  input: PutProviderConfigRequest & { actor: ProviderConfigActor },
  deps: ProviderConfigDeps
): Promise<ProviderConfigSummary> {
  // 1. credential must be a secret-store ref, never a plaintext secret.
  if (input.credentialRef != null && !input.credentialRef.startsWith("secret:")) {
    throw new ValidationError("api.error.providerCredentialNotARef", {
      safeDetails: { providerKey: input.providerKey },
    });
  }
  // 2. config carries no secret-bearing keys — secrets go through credentialRef only.
  const secretKey = Object.keys(input.config ?? {}).find((k) => SECRET_KEY.test(k));
  if (secretKey) {
    throw new ValidationError("api.error.providerConfigHasSecretKey", {
      safeDetails: { providerKey: input.providerKey, key: secretKey },
    });
  }
  // 3. a forbidden-in-production (mock) provider can never be active in production.
  if (
    input.environment === "production" &&
    input.classification === "forbidden-in-production" &&
    (input.lifecycleState === "configured" || input.lifecycleState === "ready")
  ) {
    throw new ValidationError("api.error.providerForbiddenInProduction", {
      safeDetails: { providerKey: input.providerKey, classification: input.classification },
    });
  }

  const lifecycleState = deriveLifecycle(
    input.lifecycleState,
    input.requiresCredential ?? false,
    input.credentialRef != null
  );

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.actor.actorId, // operator-global: no tenant; actor id stands in
      action: AuditAction.ProviderConfigSet,
      resource: "provider_config",
      resourceId: `${input.providerKey}:${input.environment}:${input.instanceLabel}`,
      metadata: {
        providerKey: input.providerKey,
        capability: input.capability,
        environment: input.environment,
        classification: input.classification,
        lifecycleState,
        hasCredential: input.credentialRef != null,
      },
      sourceHost: input.actor.sourceHost,
    })
  );

  const rec = await deps.providers.upsert({
    providerKey: input.providerKey,
    capability: input.capability,
    environment: input.environment,
    instanceLabel: input.instanceLabel ?? "default",
    classification: input.classification,
    lifecycleState,
    endpoint: input.endpoint ?? null,
    credentialRef: input.credentialRef ?? null,
    config: input.config ?? {},
    updatedBy: input.actor.actorId,
  });
  return toSummary(rec);
}

export type ProviderConfigMutationResult = { kind: "ok" } | { kind: "not_found" };

export async function deleteProviderConfig(
  input: { id: string; actor: ProviderConfigActor },
  deps: ProviderConfigDeps
): Promise<ProviderConfigMutationResult> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.actor.actorId,
      action: AuditAction.ProviderConfigDeleted,
      resource: "provider_config",
      resourceId: input.id,
      sourceHost: input.actor.sourceHost,
    })
  );
  const ok = await deps.providers.delete(input.id);
  return ok ? { kind: "ok" } : { kind: "not_found" };
}

/**
 * Adapter-confirmed readiness (the proof that lifecycle is NOT derived from config
 * alone): given a stored config + a LIVE adapter readiness result, the provider is
 * `ready` ONLY when the adapter says ready; a configured provider whose adapter is
 * unreachable is `degraded`; a candidate/disabled provider is unchanged. The registry
 * config can never assert `ready` by itself.
 */
export function deriveReadinessLifecycle(
  config: { lifecycleState: ProviderLifecycleState },
  adapter: { status: "ready" | "degraded" | "unreachable" } | null
): ProviderLifecycleState {
  if (config.lifecycleState === "candidate" || config.lifecycleState === "disabled") {
    return config.lifecycleState;
  }
  if (!adapter) return "degraded";
  return adapter.status === "ready" ? "ready" : "degraded";
}
