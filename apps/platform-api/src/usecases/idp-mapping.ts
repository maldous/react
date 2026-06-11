import type { IdentityProvider, IdentityProviderMapper } from "@platform/authorisation-runtime";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import {
  IdpMappingConfigSchema,
  TENANT_ROLES,
  type IdpMappingConfig,
  type OidcClaimMapping,
  type OidcRoleMapping,
  type TenantRoleValue,
} from "@platform/contracts-admin";
import { classifyRealmError } from "./realm-error.ts";

// ---------------------------------------------------------------------------
// OIDC claim / group-role mapping (ADR-0046 / ADR-ACT-0215).
//
// Bounded, typed mapping config is translated into Keycloak IdP mappers and
// applied through the RealmAdminPort. Only mappers WE manage (name-prefixed with
// `oidc-ent:`) are reconciled — hand-authored mappers (e.g. the seed
// email_verified mapper) are never touched. Role targets are allowlisted to the
// tenant roles, so a tenant admin cannot grant an arbitrary/privileged realm role
// via an upstream claim. Configured here, but NOT yet exercised through a real
// brokered login — hence the capability is `partial`, not `implemented`.
// ---------------------------------------------------------------------------

const MANAGED_PREFIX = "oidc-ent:";
const CLAIM_MAPPER = "oidc-user-attribute-idp-mapper";
const ROLE_MAPPER = "oidc-role-idp-mapper";

/** Narrow port: read an IdP and manage its mappers (the adapter satisfies it). */
export interface IdpMapperPort {
  getIdentityProvider(alias: string): Promise<IdentityProvider | null>;
  listIdentityProviderMappers(alias: string): Promise<IdentityProviderMapper[]>;
  upsertIdentityProviderMapper(alias: string, mapper: IdentityProviderMapper): Promise<void>;
  deleteIdentityProviderMapper(alias: string, mapperId: string): Promise<void>;
}

function claimMapperName(m: OidcClaimMapping): string {
  return `${MANAGED_PREFIX}claim:${m.userAttribute}`;
}
function roleMapperName(m: OidcRoleMapping): string {
  return `${MANAGED_PREFIX}role:${m.realmRole}:${m.claimValue}`;
}

/** Pure: translate the bounded mapping config into Keycloak IdP mapper reps. */
export function toKeycloakMappers(
  alias: string,
  config: IdpMappingConfig
): IdentityProviderMapper[] {
  const claims = config.claimMappings.map((m) => ({
    name: claimMapperName(m),
    identityProviderAlias: alias,
    identityProviderMapper: CLAIM_MAPPER,
    config: { syncMode: "FORCE", claim: m.upstreamClaim, "user.attribute": m.userAttribute },
  }));
  const roles = config.roleMappings.map((m) => ({
    name: roleMapperName(m),
    identityProviderAlias: alias,
    identityProviderMapper: ROLE_MAPPER,
    config: {
      syncMode: "FORCE",
      claim: m.upstreamClaim,
      "claim.value": m.claimValue,
      role: m.realmRole,
    },
  }));
  return [...claims, ...roles];
}

function isTenantRole(v: string): v is TenantRoleValue {
  return (TENANT_ROLES as readonly string[]).includes(v);
}

/** Pure: project the managed Keycloak mappers back into the redacted config DTO. */
export function fromKeycloakMappers(mappers: IdentityProviderMapper[]): IdpMappingConfig {
  const claimMappings: OidcClaimMapping[] = [];
  const roleMappings: OidcRoleMapping[] = [];
  for (const m of mappers) {
    if (!m.name?.startsWith(MANAGED_PREFIX)) continue;
    const cfg = m.config ?? {};
    if (m.identityProviderMapper === CLAIM_MAPPER) {
      const upstreamClaim = cfg["claim"];
      const userAttribute = cfg["user.attribute"];
      if (upstreamClaim && userAttribute) claimMappings.push({ upstreamClaim, userAttribute });
    } else if (m.identityProviderMapper === ROLE_MAPPER) {
      const upstreamClaim = cfg["claim"];
      const claimValue = cfg["claim.value"];
      const role = cfg["role"];
      if (upstreamClaim && claimValue && role && isTenantRole(role)) {
        roleMappings.push({ upstreamClaim, claimValue, realmRole: role });
      }
    }
  }
  return { claimMappings, roleMappings };
}

export type ReadMappingResult = { kind: "not_found" } | { kind: "ok"; config: IdpMappingConfig };

/** `GET /api/auth/settings/idps/:alias/mapping`. */
export async function readIdpMapping(
  alias: string,
  deps: { mapperPort: IdpMapperPort }
): Promise<ReadMappingResult> {
  const idp = await deps.mapperPort.getIdentityProvider(alias);
  if (!idp) return { kind: "not_found" };
  const mappers = await deps.mapperPort.listIdentityProviderMappers(alias);
  return { kind: "ok", config: fromKeycloakMappers(mappers) };
}

export interface ApplyMappingInput {
  alias: string;
  rawBody: unknown;
  organisationId: string;
  actorId: string;
  actorRoles: string[];
  sourceHost?: string;
  ipAddress?: string;
}

export interface ApplyMappingDeps {
  mapperPort: IdpMapperPort;
  audit: AuditEventPort;
}

export type ApplyMappingResult =
  | { kind: "invalid_body"; message: string }
  | { kind: "not_found" }
  | { kind: "invalid_credential" }
  | { kind: "forbidden_realm_operation" }
  | { kind: "realm_unreachable" }
  | { kind: "conflict" }
  | { kind: "ok"; config: IdpMappingConfig };

/**
 * `PATCH /api/auth/settings/idps/:alias/mapping` — full-replace of the managed
 * mappers. Audit-first: the audit event (counts only) is emitted before any
 * Keycloak write. Only `oidc-ent:`-prefixed mappers are reconciled.
 */
export async function applyIdpMapping(
  input: ApplyMappingInput,
  deps: ApplyMappingDeps
): Promise<ApplyMappingResult> {
  const parsed = IdpMappingConfigSchema.safeParse(input.rawBody);
  if (!parsed.success) {
    return { kind: "invalid_body", message: parsed.error.issues[0]?.message ?? "Invalid body" };
  }
  const config = parsed.data;

  try {
    const idp = await deps.mapperPort.getIdentityProvider(input.alias);
    if (!idp) return { kind: "not_found" };

    // Audit-first: record intent (counts only — claim/attribute names are safe,
    // never a secret) BEFORE mutating Keycloak. If this throws, no write happens.
    await deps.audit.emit(
      createAuditEvent({
        actorId: input.actorId,
        actorRoles: input.actorRoles,
        tenantId: input.organisationId,
        action: AuditAction.AuthSettingsIdpMappingChanged,
        resource: "auth_settings",
        resourceId: input.alias,
        metadata: {
          operation: "mapping",
          alias: input.alias,
          claimMappingCount: config.claimMappings.length,
          roleMappingCount: config.roleMappings.length,
        },
        sourceHost: input.sourceHost,
        ipAddress: input.ipAddress,
      })
    );

    const existing = await deps.mapperPort.listIdentityProviderMappers(input.alias);
    const existingManaged = existing.filter((m) => m.name?.startsWith(MANAGED_PREFIX));
    const byName = new Map(existingManaged.map((m) => [m.name, m] as const));
    const desired = toKeycloakMappers(input.alias, config);
    const desiredNames = new Set(desired.map((m) => m.name));

    // Upsert desired (carry the existing id forward for an in-place PUT).
    for (const mapper of desired) {
      const prior = byName.get(mapper.name);
      await deps.mapperPort.upsertIdentityProviderMapper(
        input.alias,
        prior?.id ? { ...mapper, id: prior.id } : mapper
      );
    }
    // Remove managed mappers that are no longer desired.
    for (const m of existingManaged) {
      if (m.id && !desiredNames.has(m.name)) {
        await deps.mapperPort.deleteIdentityProviderMapper(input.alias, m.id);
      }
    }
  } catch (err) {
    const classified = classifyRealmError(err);
    if (classified === "unknown") throw err;
    if (classified === "not_found") return { kind: "not_found" };
    return { kind: classified };
  }

  return { kind: "ok", config };
}
