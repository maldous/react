/**
 * TenantCredentialStore — per-tenant Auth Settings service account credentials.
 *
 * Abstracts storage and retrieval of the client ID and client secret for
 * each tenant's Keycloak realm-admin service account. The service account
 * is used exclusively by the Auth Settings API to manage IdP, MFA, session,
 * and sysadmin-brokering settings within a tenant realm.
 *
 * Secrets are never exposed in API responses, audit metadata, or logs.
 * The Postgres implementation encrypts the client secret before storage.
 */

export interface TenantAdminCredential {
  clientId: string;
  clientSecret: string; // plaintext in memory, encrypted at rest
}

/** Lifecycle metadata recorded on attach/rotate/repair (ADR-0044). No secret. */
export interface CredentialLifecycle {
  /** Actor id (system-admin) performing the lifecycle write. */
  rotatedBy?: string;
  /** True when the credential was validated against the realm before storing. */
  validated?: boolean;
}

/** Safe, secret-free view of the stored credential for the lifecycle surface. */
export interface CredentialMetadata {
  clientId: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastValidatedAt: string | null;
  lastRotatedAt: string | null;
  rotatedBy: string | null;
}

export interface TenantCredentialStore {
  /** Retrieve the auth-settings credential for a tenant, or null if not provisioned. */
  getAuthSettingsCredential(organisationId: string): Promise<TenantAdminCredential | null>;

  /**
   * Persist the auth-settings credential for a tenant. The optional `lifecycle`
   * records validation/rotation metadata (ADR-0044) — never a secret.
   */
  setAuthSettingsCredential(
    organisationId: string,
    credential: TenantAdminCredential,
    lifecycle?: CredentialLifecycle
  ): Promise<void>;

  /** Secret-free lifecycle metadata for a tenant, or null if not provisioned. */
  getAuthSettingsCredentialMetadata(organisationId: string): Promise<CredentialMetadata | null>;
}
