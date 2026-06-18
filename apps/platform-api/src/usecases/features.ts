import pg from "pg";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import { withTenant } from "@platform/adapters-postgres";

// ---------------------------------------------------------------------------
// Feature toggle usecase (ADR-ACT-0143 Slice 4)
//
// Feature toggles are stored in tenant_settings (tenant schema key-value store)
// under the key `feature.<featureKey>`. Value: {"enabled": boolean}.
//
// Definition (recorded 2026-06-02, ADR-ACT-0143 Slice 4):
//   - A feature module is a named platform capability that can be switched
//     per-tenant without deployment.
//   - Only tenant-admins can manage toggles.
//   - Stored in tenant_settings (per-tenant schema) — tenant-isolated by withTenant.
//   - Not inherited by sub-organisations; sub-orgs manage their own toggles.
//   - Audit-first: FeatureToggled audit emitted before the write.
//   - Allowed keys are hardcoded to prevent garbage injection. New features
//     require a code change + ADR update.
// ---------------------------------------------------------------------------

export const ALLOWED_FEATURE_KEYS = [
  "analytics",
  "advanced_auth",
  "audit_export",
  "webhooks",
] as const;

export type FeatureKey = (typeof ALLOWED_FEATURE_KEYS)[number];

export interface FeatureToggleState {
  key: FeatureKey;
  enabled: boolean;
  updatedAt: string | null;
}

export interface FeaturesDeps {
  audit: AuditEventPort;
  pool: pg.Pool;
}

/** Normalise a possibly-null Date|string timestamp to an ISO string or null. */
function isoOrNull(v: Date | string | null): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export async function listFeatures(
  organisationId: string,
  pool: pg.Pool
): Promise<FeatureToggleState[]> {
  const results = await withTenant(pool, organisationId, async (client) => {
    const { rows } = await client.query<{
      key: string;
      value: { enabled: boolean };
      updated_at: Date;
    }>(
      `SELECT key, value, updated_at FROM tenant_settings
       WHERE key LIKE 'feature.%'`,
      []
    );
    return rows;
  });

  const stored = new Map(results.map((r) => [r.key.replace("feature.", ""), r]));
  return ALLOWED_FEATURE_KEYS.map((k) => {
    const row = stored.get(k);
    return {
      key: k,
      enabled: row?.value?.enabled ?? false,
      updatedAt: isoOrNull(row?.updated_at ?? null),
    };
  });
}

export type ToggleFeatureResult =
  | { kind: "ok"; state: FeatureToggleState }
  | { kind: "unknown_key"; message: string }
  | { kind: "invalid_body"; message: string };

export async function toggleFeature(
  input: {
    rawBody: unknown;
    featureKey: string;
    organisationId: string;
    actorId: string;
    actorRoles: string[];
  },
  deps: FeaturesDeps
): Promise<ToggleFeatureResult> {
  if (!ALLOWED_FEATURE_KEYS.includes(input.featureKey as FeatureKey)) {
    return { kind: "unknown_key", message: `Unknown feature key: ${input.featureKey}` };
  }
  const key = input.featureKey as FeatureKey;
  const body = input.rawBody as Record<string, unknown>;
  if (typeof body?.enabled !== "boolean") {
    return { kind: "invalid_body", message: 'body must include "enabled": boolean' };
  }
  const enabled = body.enabled;

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.FeatureToggled,
      resource: "organisation:features",
      resourceId: key,
      metadata: { featureKey: key, enabled },
    })
  );

  await withTenant(deps.pool, input.organisationId, async (client) => {
    await client.query(
      `INSERT INTO tenant_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
      [`feature.${key}`, JSON.stringify({ enabled })]
    );
  });

  return {
    kind: "ok",
    state: { key, enabled, updatedAt: new Date().toISOString() },
  };
}
