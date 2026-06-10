import pg from "pg";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import { withTenant } from "@platform/adapters-postgres";
import {
  TenantAuthProvidersConfigSchema,
  UpdateTenantAuthProvidersRequestSchema,
  type TenantAuthProvidersConfig,
} from "@platform/contracts-admin";

// ---------------------------------------------------------------------------
// Per-tenant authentication provider config usecase (ADR-0037).
//
// Stores the tenant's provider mode + enabled third-party providers in
// tenant_settings (key `auth.providers`, JSONB value), the same per-tenant
// key-value store the feature toggles use — tenant-isolated by withTenant (RLS).
// Audit-first: the AuthSettingsProvidersChanged event is emitted before the write.
//
// The environment default mode and the set of available providers are NOT
// resolved here (that lives in server/auth-providers.ts); this usecase owns only
// storage + validation + audit so it stays free of server-layer imports.
// ---------------------------------------------------------------------------

export const AUTH_PROVIDERS_SETTINGS_KEY = "auth.providers";

export interface AuthProviderConfigDeps {
  audit: AuditEventPort;
  pool: pg.Pool;
}

/** Read the stored per-tenant provider config, or null when the tenant has no
 * override (callers then fall back to environment defaults). */
export async function getStoredTenantAuthProviders(
  organisationId: string,
  pool: pg.Pool
): Promise<TenantAuthProvidersConfig | null> {
  const value = await withTenant(pool, organisationId, async (client) => {
    const { rows } = await client.query<{ value: unknown }>(
      `SELECT value FROM tenant_settings WHERE key = $1 LIMIT 1`,
      [AUTH_PROVIDERS_SETTINGS_KEY]
    );
    return rows[0]?.value ?? null;
  });
  if (value == null) return null;
  const parsed = TenantAuthProvidersConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type SetAuthProvidersResult =
  | { kind: "ok"; config: TenantAuthProvidersConfig }
  | { kind: "invalid_body"; message: string };

/** Apply a partial update to the tenant's provider config (audit-first). */
export async function setTenantAuthProviders(
  input: {
    rawBody: unknown;
    organisationId: string;
    actorId: string;
    actorRoles: string[];
    /** The default config to merge a partial update onto when no override exists yet. */
    currentConfig: TenantAuthProvidersConfig;
  },
  deps: AuthProviderConfigDeps
): Promise<SetAuthProvidersResult> {
  const parsed = UpdateTenantAuthProvidersRequestSchema.safeParse(input.rawBody);
  if (!parsed.success) {
    return { kind: "invalid_body", message: parsed.error.issues[0]?.message ?? "Invalid body" };
  }

  const next: TenantAuthProvidersConfig = {
    mode: parsed.data.mode ?? input.currentConfig.mode,
    enabledProviders: parsed.data.enabledProviders ?? input.currentConfig.enabledProviders,
  };

  // Audit-first: if this throws, the write does not run.
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.AuthSettingsProvidersChanged,
      resource: "auth_settings",
      resourceId: "providers",
      metadata: { mode: next.mode, enabledProviders: next.enabledProviders },
    })
  );

  await withTenant(deps.pool, input.organisationId, async (client) => {
    await client.query(
      `INSERT INTO tenant_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
      [AUTH_PROVIDERS_SETTINGS_KEY, JSON.stringify(next)]
    );
  });

  return { kind: "ok", config: next };
}
