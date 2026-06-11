import pg from "pg";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import { withTenant } from "@platform/adapters-postgres";
import { validateConfigValue, type EffectiveConfigItem } from "@platform/contracts-admin";
import {
  PLATFORM_CONFIG_DEFINITIONS,
  findConfigDefinition,
  toConfigDefinitionDto,
  readStoredValue,
  toStoredValue,
} from "../config/registry.ts";

// ---------------------------------------------------------------------------
// Platform Configuration Registry usecases (ADR-0039).
//
// Effective value = tenant override (tenant_settings) → definition default.
// Reads are filtered by the definition's requiredPermissionRead; writes/clears
// enforce tenantOverridable + requiredPermissionWrite, validate the value against
// the definition, and are audit-first. Tenant isolation via withTenant (RLS).
// ---------------------------------------------------------------------------

export interface PlatformConfigDeps {
  audit: AuditEventPort;
  pool: pg.Pool;
}

export async function listEffectiveTenantConfig(
  input: { organisationId: string; actorPermissions: string[]; category?: string },
  pool: pg.Pool
): Promise<EffectiveConfigItem[]> {
  const defs = PLATFORM_CONFIG_DEFINITIONS.filter(
    (d) =>
      (!input.category || d.category === input.category) &&
      d.lifecycle !== "internal" &&
      input.actorPermissions.includes(d.requiredPermissionRead)
  );
  if (defs.length === 0) return [];

  const storageKeys = defs.map((d) => d.storageKey);
  const stored = await withTenant(pool, input.organisationId, async (client) => {
    const { rows } = await client.query<{ key: string; value: unknown }>(
      `SELECT key, value FROM tenant_settings WHERE key = ANY($1)`,
      [storageKeys]
    );
    return new Map(rows.map((r) => [r.key, r.value]));
  });

  return defs.map((d) => {
    const has = stored.has(d.storageKey);
    return {
      definition: toConfigDefinitionDto(d),
      value: has ? readStoredValue(d, stored.get(d.storageKey)) : d.defaultValue,
      source: has ? ("tenant_override" as const) : ("default" as const),
    };
  });
}

export async function getEffectiveTenantConfigValue(
  input: { organisationId: string; key: string; actorPermissions: string[] },
  pool: pg.Pool
): Promise<{ value: unknown; source: "default" | "tenant_override" } | null> {
  const def = findConfigDefinition(input.key);
  if (!def || !input.actorPermissions.includes(def.requiredPermissionRead)) return null;
  const stored = await withTenant(pool, input.organisationId, async (client) => {
    const { rows } = await client.query<{ value: unknown }>(
      `SELECT value FROM tenant_settings WHERE key = $1 LIMIT 1`,
      [def.storageKey]
    );
    return rows[0] ?? null;
  });
  return stored
    ? { value: readStoredValue(def, stored.value), source: "tenant_override" }
    : { value: def.defaultValue, source: "default" };
}

export type SetConfigResult =
  | { kind: "ok"; value: unknown }
  | { kind: "not_found" }
  | { kind: "not_overridable" }
  | { kind: "forbidden" }
  | { kind: "invalid_body"; message: string };

export async function setTenantConfigValue(
  input: {
    organisationId: string;
    key: string;
    rawBody: unknown;
    actorId: string;
    actorRoles: string[];
    actorPermissions: string[];
  },
  deps: PlatformConfigDeps
): Promise<SetConfigResult> {
  const def = findConfigDefinition(input.key);
  if (!def) return { kind: "not_found" };
  if (!def.tenantOverridable) return { kind: "not_overridable" };
  if (!input.actorPermissions.includes(def.requiredPermissionWrite)) return { kind: "forbidden" };

  const body = input.rawBody as { value?: unknown } | null;
  if (!body || !("value" in body)) return { kind: "invalid_body", message: "value is required" };
  const errors = validateConfigValue({
    valueType: def.valueType,
    allowedValues: def.allowedValues,
    value: body.value,
  });
  if (errors.length > 0) return { kind: "invalid_body", message: errors[0]! };

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: def.auditAction,
      resource: "organisation:config",
      resourceId: def.key,
      metadata: { key: def.key, value: body.value },
    })
  );

  await withTenant(deps.pool, input.organisationId, async (client) => {
    await client.query(
      `INSERT INTO tenant_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
      [def.storageKey, JSON.stringify(toStoredValue(def, body.value))]
    );
  });

  return { kind: "ok", value: body.value };
}

export type ClearConfigResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "not_overridable" }
  | { kind: "forbidden" };

export async function clearTenantConfigOverride(
  input: {
    organisationId: string;
    key: string;
    actorId: string;
    actorRoles: string[];
    actorPermissions: string[];
  },
  deps: PlatformConfigDeps
): Promise<ClearConfigResult> {
  const def = findConfigDefinition(input.key);
  if (!def) return { kind: "not_found" };
  if (!def.tenantOverridable) return { kind: "not_overridable" };
  if (!input.actorPermissions.includes(def.requiredPermissionWrite)) return { kind: "forbidden" };

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.ConfigValueCleared,
      resource: "organisation:config",
      resourceId: def.key,
      metadata: { key: def.key },
    })
  );

  await withTenant(deps.pool, input.organisationId, async (client) => {
    await client.query(`DELETE FROM tenant_settings WHERE key = $1`, [def.storageKey]);
  });

  return { kind: "ok" };
}
