# ADR-0068: End-user profile self-service, notification preferences, and notification substrate

## Status

Accepted (2026-06-13, ADR-ACT-0260 — Phase 6; accepted on Matt's authority per the directive). Paid/composed notification providers (Novu/Knock/Courier) and real per-channel delivery transports (Brevo/SMTP/webhook POST at scale) remain **Proposed** sub-decisions (not delivered here — the Phase-6 substrate delivers preference-gated dispatch + a durable log over local channels).

## Date

2026-06-13

## Decision owner

Architecture owner / product owner

## Consulted

Product; engineering; security; AI assistant (drafting, human review required).

## Context

The platform had an organisation (tenant) profile surface but **no end-user self-service** profile, no per-user notification **preferences**, and no notification **substrate** (only transactional tenant email config + outbound webhooks existed). This ADR splits end-user self-service + notifications out of ADR-0058 (PDP/delegated admin) and ADR-0059 (eventing). Notifications build on the Phase-5 event substrate (ADR-0059).

## Decision (Phase 6 — accepted)

1. **End-user profile self-service (build):** `user_profiles` (migration 028), tenant + user scoped (RLS). `GET/PATCH /api/me/profile`. A user can read/update **only their own** profile — the `user_id` is always taken from the authenticated session, never from a path/body param. Validated (display-name length, locale shape). Updates audited (`profile.updated`, audit-before-change).
2. **Notification preferences (build):** `notification_preferences` (migration 028), **user + tenant scoped** (RLS), keyed by `(channel, category)`. `GET/PATCH /api/me/notification-preferences`. Preference changes audited (`notification.preferences_changed`).
3. **Notification substrate (build, local-first):** a `NotificationDispatchPort` that, for a `(user, category)`, sends to each **enabled** channel via a local channel transport and writes a durable `notification_log` row (RLS). **A disabled channel suppresses dispatch.** No secret payload fields (rejected at dispatch). Channels: `email`, `webhook`, `in_app` — delivered via **local** transports (Mailpit/local sink); **no paid provider** is required for local proof.
4. **Operator surfaces (build):** `GET /api/admin/notifications/readiness` (never faked) + `POST /api/admin/tenants/:tenantId/notifications/test` (operator sends a test notification via the **local** adapter; audited `notification.tested`).
5. **Server-authoritative:** all profile/preference reads + writes + dispatch decisions are server-side; React renders BFF state only.

## Decision (Proposed sub-decisions — NOT delivered)

1. **Composed notification provider (Phase 6.5, compose/adapter, deferred):** Novu / Knock / Courier as future adapters behind `NotificationDispatchPort` — only if multi-channel/in-app at scale is proven.
2. **Real delivery transports (Phase 6.5, build, deferred):** wire the `email` channel to the existing Mailpit/Brevo email path and the `webhook` channel to an outbound POST (reusing the ADR-0052 webhook signer) — the Phase-6 substrate proves the **preference-gated dispatch + log**; production wire-send adapters follow behind the port.

### Alternatives considered

1. **Built-in user_profiles + preferences + local preference-gated dispatch substrate now; provider/transport adapters later (chosen).** Reuses the proven RLS + audit-before-change patterns; fully live-provable; honest about the transport/provider follow-up.
2. **Keycloak Account console for profile.** Keycloak owns identity, but app-level profile (display name, locale, timezone) + preferences belong in the app's tenant-scoped store; the Account console is not a substitute for preference-gated notifications.
3. **Novu composed now.** A container before a proven multi-channel need; deferred behind the port.

### Rejected alternatives (required)

- **Paid notification dependency for local proof** — rejected: local channels only; no paid provider.
- **Global (not tenant-scoped) user profile** — rejected: profiles + preferences are tenant + user scoped (RLS).
- **Users editing another user's profile** — rejected: the `user_id` is the session subject, never a param; cross-user edit is impossible.
- **Notification preferences in React only** — rejected: preferences are server-authoritative + RLS-isolated.
- **Sending notifications without a preference check** — rejected: a disabled channel suppresses dispatch.
- **Secret fields in notification payloads** — rejected: dispatch rejects secret-bearing payload keys.

### Accepted decision

Adopt option 1 for Phase 6. Built-in tenant+user-scoped profile + preferences + a local preference-gated dispatch substrate with a durable log; provider + real transports are Phase 6.5 behind the port.

## Implementation phases

1. **Substrate (Phase 6, done):** migration 028 (`user_profiles`, `notification_preferences`, `notification_log`, all RLS), `ProfileRepository` + `NotificationRepository` ports + Postgres adapters, `profile` + `notifications` usecases (own-profile-only; preference-gated dispatch; secret rejection; audited).
2. **Surfaces (Phase 6, done):** `/api/me/profile`, `/api/me/notification-preferences`, `/api/admin/notifications/readiness`, `/api/admin/tenants/:tenantId/notifications/test` (+ OpenAPI); `/admin/account` UI.
3. **Providers + transports (Phase 6.5, future):** Mailpit/Brevo email transport, webhook POST transport, Novu/Knock adapter — behind `NotificationDispatchPort`.

## Acceptance criteria

- A user reads/updates only their own profile; tenant isolation preserved; display-name/locale validated; updates audited.
- Preference read/write works + is tenant+user scoped + audited; a disabled channel suppresses dispatch; an enabled channel dispatches + logs; the test notification uses a local adapter; no secret fields in payloads.
- `proof:profile-self-service`, `proof:notification-preferences`, `proof:notification-dispatch` pass against live Postgres (SKIP honestly if unavailable).

## Proof requirements

`proof:profile-self-service`, `proof:notification-preferences`, `proof:notification-dispatch` (live Postgres). In-memory `node:test` suites (`profile`, `notifications`). No registry status upgrade from a skipped proof.

## Production blockers

- Real delivery transports (Mailpit/Brevo SMTP, webhook POST, Novu) are Phase 6.5 — the substrate proves preference-gated dispatch + log, not production wire-send.
- In-app notification inbox UI is a later surface.

## Consequences

Positive: end-user self-service + preference-gated notifications, local-first, fully live-proven, reuses RLS + audit patterns; builds on the Phase-5 event substrate.

Negative: production delivery transports + a composed provider are not yet wired (mitigated by the Phase-6.5 path behind the port).

Neutral / operational: notification_log is durable dispatch evidence; preference + profile changes are audited.

## Validation / evidence

Evidence level: Medium (PII + tenant-isolation). Local proof via the three Phase-6 proofs + node:test suites. Evidence: `docs/evidence/platform/phase-6-profile-notifications.md`.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0260; ADR-ACT-0249 profile/notification discovery).

## References

ADR-0047, ADR-0051, ADR-0052, ADR-0053, ADR-0058, ADR-0059.

## Notes

Accepted on 2026-06-13 (ADR-ACT-0260) on Matt's authority per the directive. Composed providers + real delivery transports are explicitly NOT delivered here — Phase 6.5, behind `NotificationDispatchPort`.
