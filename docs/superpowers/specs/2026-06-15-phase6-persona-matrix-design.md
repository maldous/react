# Design — Phase 6 Sub-project A: Multi-persona authed crawl (`persona-matrix`)

**Date:** 2026-06-15
**ADR:** ADR-0075 / ADR-ACT-0285 (Phase 6 remaining tail)
**Status:** Approved (design); implementation pending plan.

## Context & motivation

ADR-ACT-0285 ("environment-appropriate E2E confidence ladder") is marked **In progress**.
Phase 6 delivered the _harnesses, registries, and provisioning_ for persona +
accessibility permutation execution, but its explicitly-tracked **remaining tail** is:

> "full multi-persona AUTHED execution (fixture personas via per-persona server sessions
> in dev/test; real scaffold-login personas in staging/prod) + the cross-tenant 2nd-tenant
> persona ... the harnesses + registries + provisioning are in place; what remains is
> running them per-persona against authed stacks with creds."

Today only the `unauthenticated-visitor` persona has been executed live. The driving
question — _"do all the links on `/admin/clickthrough` (and the admin surface) work
correctly for every auth permutation?"_ — is therefore **unverified**.

The full remaining tail is three sub-projects (A → B → C):

- **A (this spec):** multi-persona authed link/route/API crawl for every provisioned persona.
- **B:** provision a 2nd tenant; wire `scaffold-cross-tenant`; assert cross-tenant denial.
- **C:** Phase 5.5 self-hosted Sentry-API event assertion.

This spec covers **A only**.

## Ground truth established during brainstorming

- This "prod" is a **local prod-stack simulation** (`infra/env/prod/prod.tfvars`:
  `keycloak_is_local = true`, `provision_fixture_users = true`), so the Keycloak realm
  contains the persona accounts. Prod terraform state has `keycloak_user` instances:
  `sysadmin`, `admin` (tenant-admin), `manager_scaffold`, `member_scaffold`,
  `disabled_scaffold`, `viewer`, `forbidden`.
- **All** persona accounts are provisioned with the same password,
  `var.fixture_user_password` (`infra/modules/keycloak/main.tf` — every `initial_password`
  block uses it). `KEYCLOAK_TEST_PASSWORD` already carries that value. So the crawl logs in
  every persona with one shared password, varying only the username (from the persona's
  `provisionRef`, e.g. `keycloak:manager@fixture.local`). **No new secrets.**
- The persona contract already exists: `e2e/persona-registry.json` (21 personas) declares
  per-persona `roles`/`permissions`/`deniedPermissions`/expected+forbidden nav/routes/API/
  clickthrough. The matrix spec is a faithful _executor_ of that contract.
- Clickthrough policy source of truth: `CLICKTHROUGH_SERVICES` in
  `apps/platform-api/src/usecases/service-clickthrough.ts` (12 services); access decided by
  `decideServiceAccess()` in `apps/platform-api/src/server/forward-auth.ts`
  (system-admin → all exposed; tenant-admin → `tenant_scoped_safe` on own slug only; others → none).
- Existing reusable pieces: `e2e/external/helpers.ts` (`loginAs`, `completeKeycloakLogin`,
  `getTestCredentials`), `e2e/discovery/persona-authz.spec.ts` (single-persona, `E2E_PERSONA`),
  `e2e/support/correlation.ts` (`test` wrapper, same-origin x-e2e-\* headers),
  `e2e/prod/admin-tools.test.ts` (the `<title>Enterprise Platform</title>` SPA-hijack check).

## Architecture

**One new spec: `e2e/discovery/persona-matrix.spec.ts`**, run under
`playwright.discovery.config.ts` (baseURL from `PROD_BASE_URL`), importing `test` from
`e2e/support/correlation.ts`. It reads `e2e/persona-registry.json` and emits **one
Playwright `test()` per stage-applicable persona**, each in its own browser context, so
personas are isolated and independently reported. The persona-authz single-persona spec is
left unchanged (focused role).

### Persona selection per stage

Driven by each persona's declared stage applicability + `authMode`:

- **prod / staging:** `real` and `unauthenticated` personas. `fixture-*` personas are
  excluded (registry bars them from staging/prod). `a11y-*` excluded (owned by
  `accessibility.spec.ts`).
- **dev / test:** `fixture` + `unauthenticated` personas, authenticated via
  `LOCAL_FIXTURE_SESSION` (per-server session), not real Keycloak login.
- `scaffold-cross-tenant` is **included but skipped-with-reason** ("no 2nd tenant — sub-project B")
  until B lands. Recorded as an honest pending gap, never a pass or a hard fail.

### Credential mapping

`username` is parsed from the persona's `provisionRef` (`keycloak:<username>` →
`<username>`); `password` is `process.env.KEYCLOAK_TEST_PASSWORD` for **all** real personas.
Unauthenticated persona performs no login.

### Per-persona checks (the matrix)

For each selected persona:

1. **Authenticate** — real → `loginAs(page, username, KEYCLOAK_TEST_PASSWORD)`;
   unauthenticated → none. Special handling in the next section.
2. **Session sanity** — `GET /api/session`; assert the returned `roles` match the persona's
   declared `roles` (skip for unauthenticated / disabled).
3. **Routes** — each declared `expectedRoute` navigates and loads (not denied); each
   `forbiddenRoute` navigates and is **denied** (redirect to sign-in / surface never
   revealed — reuse persona-authz's denial assertion).
4. **APIs** — each declared `forbiddenApiAccess` returns **401/403**; declared allowed APIs
   (if any) return 2xx.
5. **Clickthrough (core)** — for every service in `CLICKTHROUGH_SERVICES`, the _expected_
   outcome for this persona is taken from the registry's per-persona clickthrough
   declaration, **cross-checked against `decideServiceAccess`** (mismatch between registry
   and policy is itself a reported failure):
   - **Granted** → navigate the service `apexPath` (or `tenantPath` on a tenant host);
     assert it loads the **real service UI**: HTTP `<400`, not 401/403, and body does **not**
     contain `<title>Enterprise Platform</title>` (the SPA-hijack marker).
   - **Denied** → assert 401/403 and that the link is not offered on `/admin/clickthrough`.

### Special personas

- `disabled-user` → login is **rejected** (Keycloak account disabled); assert no session is
  established and protected routes remain denied.
- `expired-session` → login, then clear/expire the session cookie; assert protected routes
  are denied.
- `support-breakglass` → system-admin via a support-mode session; assert elevated access.
  **Open item:** confirm whether support-mode needs explicit activation beyond login; if so,
  the plan adds that step.
- entitlement / quota / rate-limited personas → their clickthrough/route expectations equal
  their base role; included for completeness, asserting the registry's declared contract.

### Evidence & gating

- Writes `docs/evidence/e2e/<stage>-persona-matrix-latest.{json,md}` — the full
  persona × check matrix with per-cell pass/fail/skip and reasons.
- New suite-registry entry `discovery-persona-matrix` (so coverage validation sees it).
- New make group `e2e-persona-matrix` (`make e2e-persona-matrix ENV=<stage>`), wired into
  `env/stage-policy.yaml` (dev/test/staging/prod), `make/e2e.mk`, and
  `scripts/tests/run-env-tests.sh`.
- **FAILS (exit 1)** on any matrix mismatch (a link/route/API that does not match its
  declared expectation, or a registry↔policy disagreement). **DEGRADED (exit 0, recorded)**
  when `KEYCLOAK_TEST_*` creds are absent — mirroring the existing auth-e2e gate, so dev/test
  stay green on fixtures and staging/prod demand real auth (FULL only promotes).

## Files (anticipated)

| File                                                        | Change                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `e2e/discovery/persona-matrix.spec.ts`                      | **new** — the multi-persona crawl                                      |
| `e2e/persona-registry.json`                                 | add per-persona clickthrough expectations if missing (else read as-is) |
| `e2e/suite-registry.json`                                   | **new entry** `discovery-persona-matrix`                               |
| `make/e2e.mk`                                               | **new target** `e2e-persona-matrix`                                    |
| `env/stage-policy.yaml`                                     | add `e2e-persona-matrix` to dev/test/staging/prod required groups      |
| `scripts/tests/run-env-tests.sh`                            | run the new group; honest FULL/DEGRADED/FAILED                         |
| `docs/evidence/e2e/<stage>-persona-matrix-latest.{json,md}` | generated evidence                                                     |
| `docs/adr/ACTION-REGISTER.md`                               | progress note for ADR-ACT-0285 (A delivered; B/C tail remains)         |

## Out of scope (other sub-projects)

- 2nd-tenant provisioning + `scaffold-cross-tenant` execution → **B**.
- Phase 5.5 Sentry-API event assertion → **C**.
- The ADR-ACT-0285 row flips In progress → **DONE only after A + B + C** land.

## Risks / open items

1. **Registry clickthrough expectations** — use the registry's per-persona declaration if
   present; otherwise derive expected from `decideServiceAccess` and note the derivation.
2. **support-breakglass** — support-mode may need explicit activation beyond login.
3. **Navigating real service GUIs** (Grafana/MinIO/etc.) may have slow loads / their own auth
   handshakes; the "service loaded" assertion must be robust (status + title check + a
   bounded wait), not brittle on service-specific DOM.
4. **Live prod runs** — the crawl logs into and navigates the running local prod-stack; it is
   read-only (GET navigations only; never submits forms / destructive actions).

## Acceptance criteria

- `make e2e-persona-matrix ENV=prod` runs every applicable persona authenticated, asserts the
  full route/API/clickthrough matrix, and writes `prod-persona-matrix-latest.{json,md}`.
- Proven to FAIL (exit 1) on an injected matrix mismatch.
- `discovery-persona-matrix` present in suite-registry; coverage validators pass.
- Wired so `make all` runs it per stage (FULL on prod with creds; DEGRADED honestly without).
- ACTION-REGISTER updated with A's delivery and the remaining B/C tail.
