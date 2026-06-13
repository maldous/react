// ---------------------------------------------------------------------------
// Notifications usecase (ADR-0068 / ADR-ACT-0260)
//
// Per-user notification preferences + a preference-gated dispatch substrate with a
// durable log. A DISABLED channel suppresses dispatch (logged as suppressed); an
// ENABLED channel delivers via a LOCAL transport and is logged as sent. No secret
// payload fields (rejected). Preference changes + operator test sends are audited.
// Local channels only — no paid provider. Real transports (Mailpit/Brevo/Novu/webhook
// POST) are Phase-6.5 behind NotificationTransport.
// ---------------------------------------------------------------------------

import { ValidationError } from "@platform/platform-errors";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import {
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationDispatchResult,
  type NotificationPreferencesResponse,
  type NotificationReadinessResponse,
  type TestNotificationResponse,
} from "@platform/contracts-admin";
import type {
  NotificationRepository,
  NotificationTransportRegistry,
  PreferenceRecord,
} from "../ports/notification-repository.ts";

export interface NotificationsDeps {
  notifications: NotificationRepository;
  audit: AuditEventPort;
  /** Local channel transports. Default sink is used for any channel not provided. */
  transports?: NotificationTransportRegistry | undefined;
}

export interface NotificationsActor {
  actorId: string;
  actorRoles: string[];
  sourceHost?: string | undefined;
}

const SECRET_KEY_RE = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;

// Default local transport: a local sink. The durable notification_log row is the
// artifact; production wire-send adapters (Mailpit/Brevo/webhook POST/Novu) plug in here.
const localSink = async (): Promise<"sent"> => "sent";

export async function getMyPreferences(
  organisationId: string,
  userId: string,
  deps: NotificationsDeps
): Promise<NotificationPreferencesResponse> {
  const preferences = await deps.notifications.listPreferences(organisationId, userId);
  return { preferences };
}

/** Update the calling user's own preferences (audited). */
export async function updateMyPreferences(
  input: {
    organisationId: string;
    userId: string;
    preferences: PreferenceRecord[];
    actor: NotificationsActor;
  },
  deps: NotificationsDeps
): Promise<NotificationPreferencesResponse> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.NotificationPreferencesChanged,
      resource: "notification_preference",
      resourceId: input.userId,
      metadata: { count: input.preferences.length },
      sourceHost: input.actor.sourceHost,
    })
  );
  await deps.notifications.upsertPreferences({
    organisationId: input.organisationId,
    userId: input.userId,
    preferences: input.preferences,
  });
  return getMyPreferences(input.organisationId, input.userId, deps);
}

/**
 * Dispatch a notification for a (user, category). For each configured channel: a
 * disabled preference suppresses (logged suppressed); an enabled preference delivers
 * via the local transport (logged sent/failed). Rejects secret-bearing payload fields.
 */
export async function dispatchNotification(
  input: {
    organisationId: string;
    userId: string;
    category: NotificationCategory;
    subject: string;
    payload?: Record<string, unknown> | undefined;
  },
  deps: NotificationsDeps,
  opts: { operator?: boolean } = {}
): Promise<NotificationDispatchResult[]> {
  const offending = Object.keys(input.payload ?? {}).filter((k) => SECRET_KEY_RE.test(k));
  if (offending.length > 0) {
    throw new ValidationError("api.error.secretFieldNotNotifiable", {
      safeDetails: { fields: offending },
    });
  }
  const prefs = opts.operator
    ? await deps.notifications.listPreferencesAsOperator(input.organisationId, input.userId)
    : await deps.notifications.listPreferences(input.organisationId, input.userId);
  const forCategory = prefs.filter((p) => p.category === input.category);
  const results: NotificationDispatchResult[] = [];
  for (const p of forCategory) {
    if (!p.enabled) {
      await deps.notifications.logDispatch({
        organisationId: input.organisationId,
        userId: input.userId,
        channel: p.channel,
        category: input.category,
        status: "suppressed",
        subject: input.subject,
      });
      results.push({ channel: p.channel, status: "suppressed" });
      continue;
    }
    const transport = deps.transports?.[p.channel] ?? localSink;
    const status = await transport({
      organisationId: input.organisationId,
      userId: input.userId,
      channel: p.channel,
      category: input.category,
      subject: input.subject,
    });
    await deps.notifications.logDispatch({
      organisationId: input.organisationId,
      userId: input.userId,
      channel: p.channel,
      category: input.category,
      status,
      subject: input.subject,
    });
    results.push({ channel: p.channel, status });
  }
  return results;
}

/** Operator readiness: which local channel transports are available. Never faked. */
export async function getNotificationReadiness(
  deps: NotificationsDeps
): Promise<NotificationReadinessResponse> {
  return {
    channels: NOTIFICATION_CHANNELS.map((channel) => {
      const hasTransport = Boolean(deps.transports?.[channel]);
      return {
        channel,
        available: true,
        transport: hasTransport ? "configured-local" : "local-sink",
        detail: hasTransport
          ? "A local channel transport is configured."
          : "Using the built-in local sink (durable log). Real delivery transport is Phase 6.5.",
      };
    }),
  };
}

/** Operator-only, audited test send to a target user via the local adapter. */
export async function sendTestNotification(
  input: {
    organisationId: string;
    userId: string;
    category: NotificationCategory;
    actor: NotificationsActor;
  },
  deps: NotificationsDeps
): Promise<TestNotificationResponse> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.NotificationTested,
      resource: "notification",
      resourceId: input.userId,
      metadata: { category: input.category },
      sourceHost: input.actor.sourceHost,
    })
  );
  const dispatched = await dispatchNotification(
    {
      organisationId: input.organisationId,
      userId: input.userId,
      category: input.category,
      subject: `Test notification (${input.category})`,
    },
    deps,
    { operator: true }
  );
  return { dispatched };
}
