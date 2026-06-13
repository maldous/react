# Phase 6 — profile self-service + notification preferences + substrate (delivery evidence)

- **Action:** ADR-ACT-0260 — governing ADR: ADR-0068 (profile self-service + notifications, **Accepted** for the built-in foundation; composed providers Novu/Knock/Courier + real delivery transports remain **Proposed** Phase-6.5 sub-decisions).
- **Date:** 2026-06-13
- **Status of this document:** delivery evidence. The Universal Service Foundation is **not** complete. Phase 6 is the profile + preference + preference-gated dispatch substrate only; no composed provider and no production wire-send transports are delivered.

## Proof classification

**Live-proven** against the local Compose Postgres (real RLS) — proofs run repos as the non-superuser `platform_app` role, create + clean up their own test orgs, and SKIP honestly (exit 0) if Postgres is unavailable:

- `proof:profile-self-service` — defaults when none saved; **display-name validation**; a user reads back **their own** update; a **different user's profile is independent** (own-profile-only by session userId); **RLS** hides a tenant's profiles from a foreign tenant context; no secret columns.
- `proof:notification-preferences` — defaults to none; preferences written + read back; enabled/disabled flags round-trip; **RLS** isolation; no secret columns.
- `proof:notification-dispatch` — invokes the **real route handlers**: own profile update/read (+ no-tenant-context rejected + invalid rejected); preference update/read; operator readiness lists **local** channels; operator test send **dispatches an enabled channel (sent)** and **suppresses a disabled one**; **secret payload rejected** at dispatch; dispatch **logged durably**; no secret fields in responses; access-control metadata asserted.

In-memory `node:test` suites (`profile`, `notifications`, 8 cases total) cover the usecase logic (own-profile-only, audit, preference-gated dispatch, suppression, secret rejection, readiness, test send).

## Delivered

1. **Profile model** — `user_profiles` (migration 028): tenant + user scoped, **RLS enabled + forced** (canonical predicate), `UNIQUE (organisation_id, user_id)`; `user_id` is the IdP subject (TEXT, no local FK).
2. **Notifications model** — `notification_preferences` (per `(channel, category)` enable flag, RLS) + `notification_log` (durable dispatch record, RLS, no secret columns).
3. **Ports** — `ProfileRepository`, `NotificationRepository` (+ a `NotificationTransport` local-channel sink type) + Postgres adapters.
4. **Profile usecase** — `getMyProfile`, `updateMyProfile` — **own-profile-only** (the route passes the session `userId`, never a param), validated, **audited** (`profile.updated`, audit-before-change).
5. **Notifications usecase** — `getMyPreferences`/`updateMyPreferences` (audited `notification.preferences_changed`), `dispatchNotification` (**disabled channel suppresses**, enabled delivers via the **local** transport + logs, **secret payload rejected**), `getNotificationReadiness` (never faked), `sendTestNotification` (operator-only, audited `notification.tested`, local adapter).
6. **Routes** (+ OpenAPI): `GET/PATCH /api/me/profile`, `GET/PATCH /api/me/notification-preferences` (own-user only), `GET /api/admin/notifications/readiness`, `POST /api/admin/tenants/:tenantId/notifications/test`.
7. **Permissions** — reuse `profile.read_self` / `profile.update_self` (own self-service); new `platform.notifications.read|write` (operator) in `domain-identity`.
8. **UI** — `/admin/account`: profile form + notification-preference toggles (self-service for all); operator notifications section (readiness + test send) for `platform.notifications.write`. REST-over-BFF; React renders BFF state only.
9. **Contracts** — profile/preferences/readiness/test schemas in `@platform/contracts-admin`; `user_profile` + `notification_preference` + `notification` audit resources; `notification.preferences_changed` + `notification.tested` actions.

## Enforced invariants (proven)

A user reads/updates only their own profile (userId is the session subject — cross-user edit is structurally impossible); tenant isolation via RLS; display-name/locale validated; a disabled channel suppresses dispatch; an enabled channel dispatches + logs; the test notification uses a local adapter (no paid provider); secret payload fields rejected; profile + preference changes + test sends audited; no secret columns; server-authoritative.

## Still NOT delivered (explicitly)

- **Composed notification provider** (Novu / Knock / Courier) — Phase 6.5, behind `NotificationDispatchPort`.
- **Real delivery transports** — wiring the `email` channel to Mailpit/Brevo SMTP and the `webhook` channel to an outbound signed POST (ADR-0052) — Phase 6.5. The Phase-6 substrate proves preference-gated dispatch + durable log over local channels, not production wire-send.
- **In-app notification inbox UI** — a later surface.

## Governance

- **ADR-0068 created + Accepted** (Phase-6 foundation), split from ADR-0058 (PDP) + ADR-0059 (eventing) on Matt's authority; composed providers + real transports kept Proposed. CODEMAPS updated (68 ADRs; ADR-0068 Accepted).
- Registry: `end-user-profile-self-service` + `notifications` → **locally proven** (decision **build**). `delivery` gains a `phase-6` gate (requires ADR-0068 ready). Validator + matrix re-rendered.

## Commands run (green)

`npm run usf:validate`, `lint:md`, `test:architecture`, `tsc:check`, `openapi:drift`, `frontend:conventions`, `semgrep:gate`, `test:platform-api`, `test:frontend:run`, all prior proofs, `proof:profile-self-service` (live), `proof:notification-preferences` (live), `proof:notification-dispatch` (live), `audit:osv`, `audit:deps`, `make check`.
