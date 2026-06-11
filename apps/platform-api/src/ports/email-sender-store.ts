// Port for the write-only, encrypted-at-rest tenant email sender secret
// (ADR-0047). The secret (SMTP password or provider API key) is never returned to
// the SPA; only metadata (presence + validation timestamps) crosses the boundary.

export interface EmailSenderSecretMetadata {
  hasCredential: boolean;
  lastValidatedAt: string | null;
  updatedAt: string | null;
}

export interface EmailSenderSecretStore {
  /** Decrypted secret, or null when none is stored. Server-side use only. */
  getSecret(organisationId: string): Promise<string | null>;
  /** Upsert the encrypted secret. `validated` stamps last_validated_at. */
  setSecret(
    organisationId: string,
    secret: string,
    opts?: { validated?: boolean; rotatedBy?: string }
  ): Promise<void>;
  /** Stamp last_validated_at after a successful test-send. */
  markValidated(organisationId: string): Promise<void>;
  /** Presence + validation metadata — never the secret. */
  getMetadata(organisationId: string): Promise<EmailSenderSecretMetadata | null>;
  /** Remove the stored secret (e.g. provider switched to one needing none). */
  clear(organisationId: string): Promise<void>;
}
