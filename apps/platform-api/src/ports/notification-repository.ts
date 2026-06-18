// ---------------------------------------------------------------------------
// Notification ports (ADR-0068 / ADR-ACT-0260).
//
// Per-user preferences + a durable dispatch log, tenant + user scoped (RLS). The
// NotificationTransport is the local channel sink (Mailpit/local today; Brevo/Novu/
// webhook POST are Phase-6.5 behind it). Disabled channels suppress dispatch; no
// secret payload fields are logged or delivered.
// ---------------------------------------------------------------------------

import type {
  NotificationCategory,
  NotificationChannel,
  NotificationDispatchStatus,
} from "@platform/contracts-admin";

export interface PreferenceRecord {
  channel: NotificationChannel;
  category: NotificationCategory;
  enabled: boolean;
}

export interface UpsertPreferenceInput {
  organisationId: string;
  userId: string;
  preferences: PreferenceRecord[];
}

export interface LogDispatchInput {
  organisationId: string;
  userId: string;
  channel: NotificationChannel;
  category: NotificationCategory;
  status: NotificationDispatchStatus;
  subject?: string;
}

export interface NotificationRepository {
  listPreferences(organisationId: string, userId: string): Promise<PreferenceRecord[]>;
  /** Operator read (rls_bypass) — used by the test-notification path for a target user. */
  listPreferencesAsOperator(organisationId: string, userId: string): Promise<PreferenceRecord[]>;
  upsertPreferences(input: UpsertPreferenceInput): Promise<void>;
  logDispatch(input: LogDispatchInput): Promise<void>;
  /** Count log rows for a (user) — used by proofs/readiness. Operator (rls_bypass). */
  countLog(organisationId: string, userId: string): Promise<number>;
}

/** A single channel's local delivery. Returns the realised status. No-throw. */
export type NotificationTransport = (msg: {
  organisationId: string;
  userId: string;
  channel: NotificationChannel;
  category: NotificationCategory;
  subject: string;
}) => Promise<NotificationDispatchStatus>;

/** The local transport registry. Default registry delivers to a local sink. */
export type NotificationTransportRegistry = Partial<
  Record<NotificationChannel, NotificationTransport>
>;
