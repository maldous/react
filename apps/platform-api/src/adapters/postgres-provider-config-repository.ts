/**
 * PostgresProviderConfigRepository (ADR-0070 / ADR-ACT-0266).
 *
 * Backed by public.provider_configs (migration 032). Operator-global infra (no tenant
 * column); accessed via withSystemAdmin (mirrors worker_heartbeats). The table holds
 * NO plaintext secret — `credential_ref` is an opaque secret:<uuid> into the ADR-0069
 * secret store, guarded by a CHECK constraint; `config` holds non-secret keys only.
 */

import { withSystemAdmin } from "@platform/adapters-postgres";
import type {
  ProviderConfigRecord,
  ProviderConfigRepository,
  ProviderLifecycleState,
  UpsertProviderConfigInput,
} from "../ports/provider-config-repository.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };

interface Row {
  id: string;
  provider_key: string;
  capability: string;
  environment: "development" | "test" | "staging" | "production";
  instance_label: string;
  classification: string;
  lifecycle_state: ProviderLifecycleState;
  endpoint: string | null;
  credential_ref: string | null;
  config: Record<string, unknown> | string;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  updated_by: string | null;
}

function iso(v: Date | string | null): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : v.toISOString();
}

function toRecord(r: Row): ProviderConfigRecord {
  return {
    id: r.id,
    providerKey: r.provider_key,
    capability: r.capability,
    environment: r.environment,
    instanceLabel: r.instance_label,
    classification: r.classification,
    lifecycleState: r.lifecycle_state,
    endpoint: r.endpoint,
    credentialRef: r.credential_ref,
    config: typeof r.config === "string" ? JSON.parse(r.config) : r.config,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

const COLUMNS =
  "id, provider_key, capability, environment, instance_label, classification, lifecycle_state, endpoint, credential_ref, config, created_at, updated_at, updated_by";

export class PostgresProviderConfigRepository implements ProviderConfigRepository {
  private readonly pool: PgPool;
  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async list(): Promise<ProviderConfigRecord[]> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<Row>(
        `SELECT ${COLUMNS} FROM public.provider_configs ORDER BY capability, provider_key, environment, instance_label`
      );
      return r.rows.map(toRecord);
    });
  }

  async listForCapability(capability: string): Promise<ProviderConfigRecord[]> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<Row>(
        `SELECT ${COLUMNS} FROM public.provider_configs WHERE capability = $1 ORDER BY environment, provider_key, instance_label`,
        [capability]
      );
      return r.rows.map(toRecord);
    });
  }

  async getByKey(
    providerKey: string,
    environment: string,
    instanceLabel: string
  ): Promise<ProviderConfigRecord | null> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<Row>(
        `SELECT ${COLUMNS} FROM public.provider_configs WHERE provider_key = $1 AND environment = $2 AND instance_label = $3`,
        [providerKey, environment, instanceLabel]
      );
      return r.rows[0] ? toRecord(r.rows[0]) : null;
    });
  }

  async upsert(input: UpsertProviderConfigInput): Promise<ProviderConfigRecord> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<Row>(
        `INSERT INTO public.provider_configs
           (provider_key, capability, environment, instance_label, classification,
            lifecycle_state, endpoint, credential_ref, config, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
         ON CONFLICT (provider_key, environment, instance_label) DO UPDATE SET
           capability = EXCLUDED.capability,
           classification = EXCLUDED.classification,
           lifecycle_state = EXCLUDED.lifecycle_state,
           endpoint = EXCLUDED.endpoint,
           credential_ref = EXCLUDED.credential_ref,
           config = EXCLUDED.config,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by
         RETURNING ${COLUMNS}`,
        [
          input.providerKey,
          input.capability,
          input.environment,
          input.instanceLabel,
          input.classification,
          input.lifecycleState,
          input.endpoint,
          input.credentialRef,
          JSON.stringify(input.config ?? {}),
          input.updatedBy,
        ]
      );
      return toRecord(r.rows[0]!);
    });
  }

  async setLifecycleState(id: string, lifecycleState: ProviderLifecycleState): Promise<boolean> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        "UPDATE public.provider_configs SET lifecycle_state = $2, updated_at = now() WHERE id = $1",
        [id, lifecycleState]
      );
      return (r.rowCount ?? 0) > 0;
    });
  }

  async delete(id: string): Promise<boolean> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query("DELETE FROM public.provider_configs WHERE id = $1", [id]);
      return (r.rowCount ?? 0) > 0;
    });
  }
}
