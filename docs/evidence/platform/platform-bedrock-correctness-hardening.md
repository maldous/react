# Platform Bedrock Correctness Hardening (ADR-ACT-0236)

Date: 2026-06-12. Owner: Architecture owner / technical lead.
AI assistance: Claude (Fable 5), human-reviewed.
Scope: correctness pass over the platform bedrock — domain-claim lifecycle,
service-readiness host authority, health semantics, console-link path policy,
canonical-domain honesty, and a re-audit of the ADR-ACT-0235 tranche.

Status vocabulary used here: implemented / locally proven / production-proven /
partial / deferred / blocked / not applicable.

## Issues, sources, and fixes

### 1. Domain-claim lifecycle could mislead on cross-tenant conflicts

- **Source:** review of `ensurePending()` (`ON CONFLICT DO NOTHING` silently
  no-oped on a domain enabled for ANOTHER tenant) + `createDomainChallenge()`
  (issued a DNS token for an unclaimable domain) + `verifyDomainChallenge()`
  (could mark a challenge verified with no same-tenant registry row).
- **Fix:** `TenantDomainRegistryPort.ensurePending()` now returns
  `created | existing_same_tenant | conflict_other_tenant` (Postgres adapter:
  `INSERT … ON CONFLICT … RETURNING` + read-after-conflict ownership check,
  2-attempt loop for the disable race, fails CLOSED as conflict).
  `createDomainChallenge()` rejects `conflict_other_tenant` BEFORE generating
  a token (audited as `tenant_domains.challenge.rejected_conflict`, safe
  metadata only); `verifyDomainChallenge()` refuses the conflict BEFORE any
  DNS lookup and can only return `ok` when this tenant's lifecycle row exists.
  All four routes (org + legacy auth-settings create/verify) map the conflict
  to **409 `DOMAIN_ALREADY_CLAIMED`** — explicit, never a hidden `not_found`.
  The UI shows the explicit conflict message; no TXT panel renders.
- **Tests:** `vanity-domain-challenge.test.ts` — conflict blocks creation with
  no token and no challenge insert; same-tenant re-challenge allowed; conflict
  blocks verification before DNS; markOwnership fires only on success; no
  token in rejection audit metadata. `tenant-domain-lifecycle.test.ts` —
  cross-tenant activation stays `not_found` (registry row invisible).
- **Runtime proof:** `proof:tenant-domain-claim-lifecycle` (new, ALL PASS,
  live local Postgres): A claims + verifies; B gets no token (409 semantics),
  cannot verify, cannot activate; A remains owner; **documented policy:**
  disabling A's enabled claim FREES the domain (partial unique index guards
  enabled rows only; A's disabled history is retained); B's new claim starts
  `pending_dns`; no token leakage in any conflict outcome.
- **Status:** implemented + locally proven.
- **Remaining gap:** public-DNS verification with a real resolver remains
  blocked (no public DNS in the local stack); the DNS-shape is injected, the
  registry/challenge/conflict machinery is live.

### 2. Readiness endpoint: "no tenant context" could mean "global context"

- **Source:** ADR-ACT-0235 left system-admin readable from ANY host without
  tenant context (apex, reserved subdomains, unknown hosts alike).
- **Fix:** explicit host authority (`resolveReadinessAccess`, pure):
  tenant-resolved FQDN → `tenant_operator` view for EVERY viewer (a
  system-admin on a tenant host is **downgraded to the tenant-safe view** —
  the chosen policy; support-mode escalation is deferred, see gaps);
  system-admin on the APEX host → `system_operator` view; system-admin on
  reserved/invalid/unresolved hosts → **403 `INVALID_OPERATIONS_ORIGIN`**;
  everyone else → 400 `NO_TENANT`. The response now carries
  `viewerMode: tenant_operator | system_operator` (strict contract field).
- **Tests:** the 6-case matrix in `platform-services.test.ts` (tenant-admin on
  tenant host / apex; system-admin on apex / unknown subdomain / tenant host;
  reserved + custom + malformed host refusals).
- **Runtime proof:** `proof:platform-services` builds both views live and
  asserts the gating + viewerMode.
- **Status:** implemented + locally proven (route-level 403 is exercised via
  the pure resolver; the handler delegates to it directly).
- **Remaining gap:** system-admin support-mode escalation on a tenant host is
  **deferred** — the downgrade-to-tenant-safe policy is implemented instead
  (permitted by the directive); escalation needs an ADR.

### 3. Health semantics: structured bodies were trusted blindly

- **Source:** ADR-ACT-0235 treated any parse failure as healthy
  (`catch → null`), had no Sonar/Keycloak body checks.
- **Fix:** `jsonBodyCheck` — malformed JSON on a structured endpoint ⇒
  `degraded`. Grafana `/api/health` (valid JSON; `database` ok where present),
  LocalStack (valid JSON; no `error` services), SonarQube
  `/api/system/status` (`status === "UP"`), Keycloak discovery (valid JSON
  with non-empty `issuer`). Redis stays structural (`configured`, never
  `healthy`) with the caveat surfaced in the UI
  (`feature.admin.platform.svc.redis.detail`). Probe body cap raised
  4KB → 64KB after the live proof caught the truncated Keycloak discovery
  document faking a degraded state.
- **Tests:** malformed Grafana/LocalStack/Sonar/Keycloak bodies ⇒ degraded;
  Sonar DOWN/STARTING ⇒ degraded; Keycloak missing issuer ⇒ degraded;
  unstructured endpoints (Loki etc.) unaffected; Redis structural + detail key.
- **Runtime proof:** `proof:platform-services` — Keycloak healthy via a fully
  validated discovery document; SonarQube healthy via `status: UP`;
  `web_caddy` honestly `degraded`; LocalStack honestly `unreachable`.
- **Status:** implemented + locally proven.

### 4. Keycloak console link mixed policy and direct port

- **Source:** ADR-ACT-0235 handed tenant-admins the DIRECT local port
  (`http://localhost:8090/kc`) under a tenant-safe classification.
- **Fix:** tenant_operator viewers get the ROUTED tenant-origin path
  (`http://{tenantHost}/kc` — the Caddy/forward-auth path), labelled
  **"Routed via Caddy"**; without a routed tenant host the link is withheld
  (never a direct port dressed as tenant-safe). System operators get direct
  local ports explicitly labelled **"Direct local service port"**. New strict
  contract field `consoleUrlKind: routed | direct_local | null`; the cockpit
  renders the label badge next to every link.
- **Tests:** unit (routed tenant link, withheld without host, direct-local
  labelling for system operators) + MSW UI tests (tenant Keycloak link is
  `http://acme.aldous.info/kc` labelled routed; Grafana labelled direct-local).
- **Runtime proof:** `proof:platform-services` asserts the routed tenant link.
- **Status:** implemented + locally proven.

### 5. Canonical semantics could be misread as cutover

- **Source:** ADR-ACT-0230/0232 honesty review — canonical was honest in the
  registry but the API/UI did not make "marker only" impossible to miss.
- **Fix:** canonical is labelled a **canonical marker** everywhere: the
  canonical responses and `TenantDomainSummary` now carry
  `redirectActive: false` (constant until a redirect implementation is
  explicitly proven) alongside `redirectPolicy: no_redirect`; the UI badge
  reads "Canonical marker" with a permanent note **"No redirect is active —
  public cutover not proven."** visible to every viewer (not just writers).
- **Tests:** UI note rendered for writers AND read-only viewers; canonical
  responses carry `redirectActive: false` (strict schema enforces presence).
- **Runtime proof:** `proof:tenant-domain-canonical` extended — canonical set
  does NOT upgrade routing/TLS readiness (routing stays exactly as proven,
  TLS stays `tls_unknown`, no public timestamps appear) and redirect policy
  stays `no_redirect`. ALL PASS live.
- **Status:** implemented + locally proven.

### 6. Re-audit of the ADR-ACT-0235 tranche

Re-reviewed: `consoleAccess` contract, `CLICKTHROUGH_SERVICES`,
`SERVICE_REGISTRY`, forward-auth, Caddy route blocks, `/admin/platform`,
proof-ladder registry, backup/restore scripts, README ladder, evidence docs.

Invariants and where they are enforced (all by tests, not documentation):

| Invariant | Enforcement |
| --- | --- |
| every exposed policy service has matching Caddy reality (or explicit null route) | `service-clickthrough.test.ts` Caddyfile reconciliation (pre-existing) |
| every Caddy tool route appears in policy | same gate, exact-match per vhost (pre-existing) |
| every policy resource appears in permission bundles where intended | `service-clickthrough.test.ts` vocabulary tests (pre-existing) |
| cockpit registry classifications mirror the policy module | `platform-services.test.ts` (consoleAccessFor mirror) |
| every `proof:*` script ⇄ `PROOF_LADDER` ⇄ README | `proof-registry.test.ts` (both directions + README) |
| no `not_exposed` service has a console URL | unit + live proof (WireMock) |
| no `global_only` console URL for tenant viewers | unit + UI + live proof |
| no direct-local link presented unlabelled / as tenant-safe | unit + UI tests (consoleUrlKind) |
| no secret/DSN/token/password in readiness payload | unit regex sweep + live proof |
| no token in conflict-rejection audit metadata | unit + live claim proof |

One found-and-fixed defect from the re-audit: the 4KB probe body cap broke
the Keycloak discovery JSON check live (degraded-when-healthy) — caught by
the proof ladder, fixed to 64KB, re-proven.

## Route/permission matrix updates

| Route | Change |
| --- | --- |
| `GET /api/org/platform/services/readiness` | host-authority matrix (tenant FQDN → tenant view; apex+system-admin → operator view; other hosts → 403 `INVALID_OPERATIONS_ORIGIN`); response adds `viewerMode`; per-service `consoleUrlKind` |
| `POST /api/org/domains` | 409 `DOMAIN_ALREADY_CLAIMED` (no token issued) |
| `POST /api/org/domains/:domain/verify` | 409 `DOMAIN_ALREADY_CLAIMED` (refused before DNS) |
| `POST /api/auth/settings/domains/challenges` | 409 `DOMAIN_ALREADY_CLAIMED` |
| `POST /api/auth/settings/domains/verify` | 409 `DOMAIN_ALREADY_CLAIMED` |
| `POST/DELETE /api/org/domains/:domain/canonical` | response adds `redirectActive: false` |
| `GET /api/org/domains` | summaries add `redirectActive: false` |

Permission bundles unchanged this slice (system-admin gained
`tenant.platform.read` in ADR-ACT-0235; no new permissions).

## No-secret guarantee

No credential, DSN, token, password, webhook secret, SMTP password, S3 key,
or Keycloak secret appears in any readiness payload, domain response, or new
audit metadata. Enforced by: the unit regex sweep over the assembled readiness
payload, the live-proof leak checks (`proof:platform-services`,
`proof:tenant-domain-claim-lifecycle` — including the conflict path and its
audit events), and the conflict responses carrying only a code + message.

## No-fake-readiness guarantee

`healthy` requires a 2xx response AND a valid structured body where one is
defined; malformed bodies and non-2xx are `degraded`; no response is
`unreachable`; Redis is `configured` (structural, labelled); canonical never
upgrades routing/TLS; verification cannot succeed without this tenant's
lifecycle row; activation cannot cross tenants. Each clause is unit-tested and
exercised in the live proofs listed below.

## Tests run

`tsc:check` (3 projects), `test:platform-api` (645 → 658 with this slice),
`test:frontend:run` (179 → 181), `test:architecture` (792), `openapi:drift`
(99 routes), `frontend:conventions`, `semgrep:gate`, `make check`.

## Runtime proofs executed (full ladder, live local stack)

All 20 proofs PASS: auth-settings, auth-idps, auth-credential-lifecycle,
auth-oidc-enterprise, email-sender, tenant-domains, tenant-domains-routing,
tenant-storage, tenant-observability, webhooks, webhook-worker,
webhook-redrive, platform-services, backup-local, domain-identity-matrix,
tenant-custom-domain-resolution, tenant-domain-canonical,
tenant-custom-domain-auth-origin, service-clickthrough-policy, and the new
**tenant-domain-claim-lifecycle**.

Honest classifications inside passing proofs: LocalStack `unreachable`
(profile not running — honest, not a failure); `web_caddy` `degraded` (non-2xx
responder on the configured port); real-IdP OIDC login mapping remains
blocked (ADR-ACT-0220) and is labelled so by its proof.

## Known deferrals / blockers

- System-admin support-mode escalation on tenant hosts — **deferred**
  (downgrade policy implemented; escalation needs an ADR).
- Public DNS / TLS / cutover and real-IdP login on custom domains —
  **blocked** on external dependencies (unchanged).
- Redirect implementation behind `redirectPolicy` — **deferred**;
  `redirectActive` stays false until proven.
- Persistent worker heartbeat store — **deferred** (unchanged caveat).

## ACTION-REGISTER linkage

ADR-ACT-0236 (Source: ADR-0029/ADR-0030/ADR-0048; depends on ADR-ACT-0232,
ADR-ACT-0233, ADR-ACT-0235). Evidence: this file.
