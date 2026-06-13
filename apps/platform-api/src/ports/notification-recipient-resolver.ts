// ---------------------------------------------------------------------------
// Notification recipient resolver port (ADR-0068 / ADR-ACT-0273) — Phase 6.5.
//
// Real notification transports need a DESTINATION the dispatch input does not carry
// (the (user, category) tuple is not an address). This resolver is the server-side
// seam that turns a (organisationId, userId) into a concrete email recipient and a
// per-tenant webhook destination. It is resolved server-side (never trusted from the
// client) and returns null when no destination is configured — a null destination
// makes the transport report `failed` honestly (never a silent success).
//
// This pass delivers a configured resolver (operator/env-configured destinations);
// IdP-backed per-user email (from Keycloak) + per-subscription webhook routing are
// documented follow-ups behind this same port.
// ---------------------------------------------------------------------------

export interface NotificationRecipientResolver {
  /** The email address to deliver to, or null when none is resolvable. */
  resolveEmail(organisationId: string, userId: string): Promise<string | null>;
  /** The signed-webhook destination URL for the tenant, or null. */
  resolveWebhookUrl(organisationId: string, userId: string): Promise<string | null>;
}
