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

export interface TenantCredentialStore {
  /** Retrieve the auth-settings credential for a tenant, or null if not provisioned. */
  getAuthSettingsCredential(organisationId: string): Promise<TenantAdminCredential | null>;

  /** Persist the auth-settings credential for a tenant. */
  setAuthSettingsCredential(
    organisationId: string,
    credential: TenantAdminCredential
  ): Promise<void>;
}
