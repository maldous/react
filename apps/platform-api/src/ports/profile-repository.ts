// ---------------------------------------------------------------------------
// Profile repository port (ADR-0068 / ADR-ACT-0260).
//
// End-user profile, tenant + user scoped (RLS). A user only ever reads/writes their
// own profile — the usecase passes the session userId, never a param. No secrets.
// ---------------------------------------------------------------------------

export interface ProfileRecord {
  displayName: string;
  locale: string;
  timezone: string;
}

export interface UpsertProfileInput {
  organisationId: string;
  userId: string;
  displayName: string;
  locale: string;
  timezone: string;
}

export interface ProfileRepository {
  /** The user's own profile, or null when none has been saved yet. RLS-scoped. */
  getForUser(organisationId: string, userId: string): Promise<ProfileRecord | null>;
  upsertForUser(input: UpsertProfileInput): Promise<ProfileRecord>;
}
