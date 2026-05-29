import pg from "pg";
import type { User, ExternalIdentity, Membership, TenantRole } from "@platform/domain-identity";
import { ConflictError } from "@platform/platform-errors";
import type { IdentityRepository } from "./ports.ts";
import { withSystemAdmin } from "./index.ts";

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row["id"] as string,
    email: row["email"] as string,
    displayName: row["display_name"] as string,
    createdAt: row["created_at"] as Date,
    updatedAt: row["updated_at"] as Date,
  };
}

function rowToExternalIdentity(row: Record<string, unknown>): ExternalIdentity {
  return {
    id: row["id"] as string,
    userId: row["user_id"] as string,
    provider: row["provider"] as string,
    providerSubject: row["provider_subject"] as string,
    createdAt: row["created_at"] as Date,
  };
}

function rowToMembership(row: Record<string, unknown>): Membership & { role: TenantRole } {
  return {
    id: row["id"] as string,
    userId: row["user_id"] as string,
    organisationId: row["organisation_id"] as string,
    role: row["role"] as TenantRole,
    createdAt: row["created_at"] as Date,
    updatedAt: row["updated_at"] as Date,
  };
}

export class PostgresIdentityRepository implements IdentityRepository {
  private readonly pool: pg.Pool;

  constructor(connectionString: string, pool?: pg.Pool) {
    this.pool = pool ?? new pg.Pool({ connectionString, max: 10 });
  }

  // Identity operations cross the tenant boundary (a user can belong to
  // multiple tenants, and the auth callback runs before any tenant context
  // is established). All methods use withSystemAdmin so they function
  // correctly when the app DB user is a non-superuser with RLS enforced.
  // ADR-0031 §PostgreSQL privilege analysis; ADR-ACT-0153.

  async findExternalIdentity(
    provider: string,
    providerSubject: string
  ): Promise<{ user: User; externalIdentity: ExternalIdentity } | null> {
    return withSystemAdmin(this.pool, async (client) => {
      const { rows } = await client.query(
        `SELECT
           ei.id               AS ei_id,
           ei.user_id          AS ei_user_id,
           ei.provider         AS ei_provider,
           ei.provider_subject AS ei_provider_subject,
           ei.created_at       AS ei_created_at,
           u.id                AS u_id,
           u.email             AS u_email,
           u.display_name      AS u_display_name,
           u.created_at        AS u_created_at,
           u.updated_at        AS u_updated_at
         FROM external_identities ei
         JOIN users u ON u.id = ei.user_id
         WHERE ei.provider = $1 AND ei.provider_subject = $2`,
        [provider, providerSubject]
      );
      if (!rows.length) return null;
      const row = rows[0] as Record<string, unknown>;
      const user = rowToUser({
        id: row["u_id"],
        email: row["u_email"],
        display_name: row["u_display_name"],
        created_at: row["u_created_at"],
        updated_at: row["u_updated_at"],
      });
      const externalIdentity = rowToExternalIdentity({
        id: row["ei_id"],
        user_id: row["ei_user_id"],
        provider: row["ei_provider"],
        provider_subject: row["ei_provider_subject"],
        created_at: row["ei_created_at"],
      });
      return { user, externalIdentity };
    });
  }

  async createUserAndExternalIdentity(input: {
    email: string;
    displayName: string;
    provider: string;
    providerSubject: string;
  }): Promise<{ user: User; externalIdentity: ExternalIdentity }> {
    return withSystemAdmin(this.pool, async (client) => {
      const userResult = await client.query(
        `INSERT INTO users (email, display_name)
         VALUES ($1, $2)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, email, display_name, created_at, updated_at`,
        [input.email, input.displayName]
      );
      if (!userResult.rows.length) {
        throw new ConflictError(
          "An account with this email exists but is not linked to this identity provider. " +
            "Contact an administrator to link accounts.",
          { safeDetails: { provider: input.provider } }
        );
      }
      const user = rowToUser(userResult.rows[0] as Record<string, unknown>);
      const eiResult = await client.query(
        `INSERT INTO external_identities (user_id, provider, provider_subject)
         VALUES ($1, $2, $3)
         RETURNING id, user_id, provider, provider_subject, created_at`,
        [user.id, input.provider, input.providerSubject]
      );
      const externalIdentity = rowToExternalIdentity(eiResult.rows[0] as Record<string, unknown>);
      return { user, externalIdentity };
    });
  }

  async findMembershipByUser(userId: string): Promise<(Membership & { role: TenantRole }) | null> {
    return withSystemAdmin(this.pool, async (client) => {
      const { rows } = await client.query(
        `SELECT id, user_id, organisation_id, role, created_at, updated_at
         FROM memberships
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId]
      );
      if (!rows.length) return null;
      return rowToMembership(rows[0] as Record<string, unknown>);
    });
  }
}
