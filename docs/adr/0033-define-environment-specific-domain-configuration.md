# ADR-0033: Define environment-specific domain and hostname configuration

## Status

Accepted

## Date

2026-05-30

## Decision owner

Architecture owner / technical lead

## Consulted

- ADR-0022 (authentication, session, SSO boundary — Keycloak hostname, issuer)
- ADR-0023 (declarative infrastructure provisioning — environment model)
- ADR-0027 (Tilt local development feedback loop — dev mode topology)
- ADR-0029 (multi-tenant isolation boundaries — FQDN tenant routing)
- ADR-0032 (E2E testing strategy — dev vs prod test classification)

## Context

The platform needs three distinct environment profiles — **dev**, **test**, and **prod** — with different domain conventions, Keycloak hostname configurations, and Caddy routing rules. The previous ADR-ACT fix (KC_HOSTNAME + STRICT_BACKCHANNEL) worked only for the local dev case (`http://localhost/kc`). It broke for production because:

1. Production uses HTTPS via Cloudflare; the token issuer must be `https://aldous.info/kc`, not `http://localhost/kc`.
2. Multi-tenant dev requires a `.localhost` TLD that resolves to `127.0.0.1` without `/etc/hosts` entries.
3. No single KC_HOSTNAME value works across all environments.

Additionally, the platform must support **dynamic tenant provisioning** across all environments — tenants created at runtime via `POST /api/admin/tenants` should immediately be accessible at `{slug}.{apexDomain}` without any container or deployment restart.

The `.localhost` TLD (RFC 6761) resolves to `127.0.0.1` on all modern operating systems and browsers. This makes it the ideal developer-experience domain: no DNS, no `/etc/hosts`, no mDNS — it just works. Caddy 2 natively handles wildcard `.localhost` hostnames.

## Stakeholder concerns

- **Developer experience:** Must work without `/etc/hosts` entries or DNS configuration. `tilt up` or `make dev-up` should immediately serve the app and all tenants at `.localhost` URLs.
- **Production fidelity:** The prod environment uses the real domain (`aldous.info`) with Cloudflare TLS. The same Compose/web profile config (with different env vars) should work for both dev and prod.
- **Operations:** Each environment (development, test, staging, production) must have its own KC_HOSTNAME matching its public URL. No environment should depend on another's domain configuration.
- **Tenant provisioning:** Creating a tenant at runtime must work identically across all environments. The only difference is the APEX_DOMAIN value — the provisioning logic is environment-agnostic.

## Decision drivers

1. `.localhost` is the universal dev TLD — no DNS, no `/etc/hosts`, no workarounds.
2. KC_HOSTNAME must match the public-facing URL in every environment. No shared default works.
3. Caddy must serve all domains — both `.aldous.info` and `.localhost` — from the same config so the same Docker image works everywhere.
4. Tenant resolver uses `APEX_DOMAIN` env var — switching environments is a config change, not a code change.

## Decision

### 1. Environment model

| Environment | APEX_DOMAIN           | KC_HOSTNAME                      | Scheme | Notes                                  |
| ----------- | --------------------- | -------------------------------- | ------ | -------------------------------------- |
| Dev (Tilt)  | `dev.localhost`       | `http://dev.localhost/kc`        | HTTP   | Auto-resolving `.localhost` TLD        |
| Dev (Caddy) | `dev.localhost`       | `http://dev.localhost/kc`        | HTTP   | Same as Tilt; uses Compose web profile |
| Test/CI     | `test.localhost`      | `http://test.localhost/kc`       | HTTP   | Separate `.localhost` TLD for test     |
| Staging     | `staging.aldous.info` | `https://staging.aldous.info/kc` | HTTPS  | Separate subdomain, staging env        |
| Production  | `aldous.info`         | `https://aldous.info/kc`         | HTTPS  | Cloudflare TLS termination             |

### 2. FQDN conventions per environment

**Dev (`.localhost` TLD, auto-resolving, port 8080):**

```text
dev.localhost:8080              ← super-global admin console (dev environment)
{slug}.dev.localhost:8080       ← per-tenant application (dev environment)
```

**Test/CI (`.localhost` TLD, auto-resolving, port 81):**

```text
test.localhost:81               ← super-global admin console (test environment)
{slug}.test.localhost:81        ← per-tenant application (test environment)
```

**Staging (real DNS via Cloudflare to port 82 internal Caddy):**

```text
staging.aldous.info             ← super-global admin console (staging environment)
{slug}.staging.aldous.info      ← per-tenant application (staging environment)
```

**Production (real DNS via Cloudflare to port 83 internal Caddy):**

```text
aldous.info                     ← super-global admin console
{slug}.aldous.info              ← per-tenant application
```

The `.localhost` TLD resolves to `127.0.0.1` via the OS stub resolver (RFC 6761). No `/etc/hosts` entry required. Browsers and Caddy both handle it without configuration.

### External Caddy (port 80)

A dedicated external-facing Caddy listens on port 80 (host networking) and receives
Cloudflare-terminated HTTP traffic (Flexible SSL). It routes by Host header to
per-environment internal Caddies:

```text
staging.aldous.info  ──► external Caddy :80 ──► localhost:82 (staging internal Caddy)
aldous.info          ──► external Caddy :80 ──► localhost:83 (prod internal Caddy)
```

The external Caddy is a pure reverse-proxy routing layer — no SPA files, no tool
routing logic. It runs as a Docker container with `network_mode: host` so it can
reach per-environment internal Caddies on their published host ports.

**No `/etc/hosts` entries should override `aldous.info` or `staging.aldous.info`**
— these domains must resolve to real Cloudflare edge IPs for the external Caddy
pipeline to work. If local testing via `http://aldous.info` is needed, the
`/etc/hosts` entry can be temporarily toggled (uncommented), but must be disabled
before running `stage-staging` or `stage-prod`.

| Environment | Internal Caddy port | External Caddy routes                |
| ----------- | ------------------- | ------------------------------------ |
| Dev         | 8080                | (direct access)                      |
| Test        | 81                  | (direct access)                      |
| Staging     | 82                  | `staging.aldous.info → localhost:82` |
| Prod        | 83                  | `aldous.info → localhost:83`         |

Wildcard TLS (`*.aldous.info`) via Cloudflare. Caddy sees plain HTTP on `:80` (Cloudflare Flexible SSL).

### 3. Dynamic tenant provisioning (all environments)

Tenants are created at runtime via `POST /api/admin/tenants`. The provisioning creates:

1. Organisation record in `public.organisations` with the slug
2. Keycloak realm `tenant-{id}`
3. PostgreSQL schema `tenant_{id}`
4. Redis ACL namespace
5. S3 bucket prefix

The tenant is immediately accessible at `{slug}.{apexDomain}` because:

- **Caddy** has a wildcard `*.{apexDomain}` block that matches any subdomain — no restart needed.
- **Tenant resolver** (`extractSlugFromHost`) reads the `Host` header, matches against `APEX_DOMAIN`, and resolves the slug against the database at runtime.
- **Keycloak realm** exists in the running Keycloak instance — no restart needed.
- **Database schema** is created dynamically.

No build, no deployment, no container restart. The platform serves the new tenant immediately after the provisioning API call completes.

### 4. Concurrent environment isolation (ADR-ACT-0169)

All 4 environments — dev, test, staging, prod — run as fully isolated Docker Compose
stacks on the same host:

- **`COMPOSE_PROJECT_NAME`** set to the environment name (`dev`, `test`, `staging`, `prod`)
  via `ENV` in the Makefile. This namespaces all containers, volumes, and networks.
- **Per-environment `.env.<env>` files** mapping unique host ports.
- **Per-environment domain** via `APEX_DOMAIN` and `KC_HOSTNAME`.
- **Single `compose.yaml`** shared by all environments — only `.env` files differ.

#### Port allocation

| Service         | Dev (:8080) | Test (:81) | Staging (:82) | Prod (:83) |
| --------------- | ----------- | ---------- | ------------- | ---------- |
| Caddy (web)     | 8080        | 81         | 82            | 83         |
| platform-api    | 3001        | 3002       | 3003          | 3004       |
| Postgres        | 5433        | 5434       | 5435          | 5436       |
| Redis           | 6379        | 6380       | 6381          | 6382       |
| Keycloak        | 8090        | 8091       | 8092          | 8093       |
| ClickHouse HTTP | 8124        | 8125       | 8126          | 8127       |
| MinIO API       | 9000        | 9010       | 9020          | 9030       |
| MinIO Console   | 9001        | 9011       | 9021          | 9031       |
| Mailpit SMTP    | 1025        | 1026       | 1027          | 1028       |
| Mailpit UI      | 8025        | 8026       | 8027          | 8028       |

#### Usage

```bash
make dev-up              # Dev stack (port 8080, dev.localhost:8080)
make test-up             # Test stack (port 81, test.localhost:81)
make staging-up          # Staging stack (port 82, staging.aldous.info)
make prod-up             # Prod-like stack (port 83, aldous.info)
make external-caddy-up   # External Caddy on port 80 (Cloudflare-facing)

# Target individual phases per environment:
ENV=test make compose-up-default
ENV=test make compose-up-identity
ENV=test make compose-up-web

# Stop all 4 environments
make clean-all
```

### 5. Data model: destructive vs. preserving environments

The 4 environments form a confidence progression, each testing a distinct property:

| Stage   | Data model  | Behaviour                                                       | Confidence gained                                       |
| ------- | ----------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| Dev     | Destructive | `compose-down-reset` → Tilt → tests → destroy                   | **Clean behaviour** — app works from scratch            |
| Test    | Destructive | `compose-down-reset` → Compose → tests → destroy                | **Clean behaviour repeated** — full Compose parity      |
| Staging | Preserving  | Cloudflare E2E: `https://staging.aldous.info` → full test suite | **Preservation testing** — deployed environment works   |
| Prod    | Preserving  | Cloudflare E2E: `https://aldous.info` → full test suite         | **Preservation confirmation** — production-grade safety |

#### Destructive environments (dev, test)

- **Before the stage:** app data volumes (Postgres, Redis, ClickHouse, MinIO) are removed via
  `make compose-down-reset`. Keycloak and SonarQube volumes are preserved by default.
- **After the stage:** same selective reset — app data destroyed, JVM data preserved.
- **JVM volume preservation:** Keycloak and SonarQube are JVM services that take 2-4 minutes
  to initialize from scratch. Their data volumes are preserved across destructive stages to
  keep pipeline run times practical. Controlled by `PRESERVE_JVM_VOLUMES`:
  - `PRESERVE_JVM_VOLUMES=true` (default): `docker compose down` + selective `docker volume rm`
    for `postgres-data`, `redis-data`, `clickhouse-data`, `minio-data`
  - `PRESERVE_JVM_VOLUMES=false`: `docker compose down --volumes` (destroys everything)
- **Purpose:** verify that the application bootstraps, migrates, seeds, and operates correctly
  from a bare starting point. This catches missing migrations, broken seed scripts, and
  assumptions about pre-existing data.

#### Preserving environments (staging, prod)

- **Before the stage:** the local Compose stack is started for the target environment
  (staging or prod) including its internal Caddy, platform-api, Postgres, Redis,
  ClickHouse, MinIO, Keycloak, and Mailpit. The external Caddy is also started on
  port 80 to receive Cloudflare-terminated HTTP traffic.
- **During the stage:** full external E2E suite runs against `https://staging.aldous.info`
  (staging) or `https://aldous.info` (prod). Traffic flows:
  `browser → Cloudflare → external Caddy :80 → internal Caddy :82/:83 → platform-api`
  Tests exercise real DNS, Cloudflare TLS termination, HTTP routing, and the complete
  deployed application stack end-to-end.
- **After the stage:** the external Caddy is stopped, then the local Compose stack is torn
  down. Data is preserved across runs on the real Cloudflare-deployed environment.
- **Purpose:** verify that the deployed application handles real user traffic correctly.
  Staging adds **preservation testing** (does the deployed environment work?), while prod
  adds **preservation confirmation** (the final confidence gate before declaring a release
  ready).
- **Prerequisites:** the target domain must be DNS-resolvable to Cloudflare edge IPs
  (no `/etc/hosts` override). `KEYCLOAK_TEST_PASSWORD` should be set for auth tests
  (they are gracefully skipped if not).

#### Sub-stage naming

| Target               | Data model  | Lifecycle                                                                            |
| -------------------- | ----------- | ------------------------------------------------------------------------------------ |
| `make stage-dev`     | Destructive | destroy → Tilt → tests → destroy                                                     |
| `make stage-test`    | Destructive | destroy → Compose → tests → destroy                                                  |
| `make stage-staging` | Preserving  | Stack → external Caddy → Cloudflare E2E: `PROD_BASE_URL=https://staging.aldous.info` |
| `make stage-prod`    | Preserving  | Stack → external Caddy → Cloudflare E2E: `PROD_BASE_URL=https://aldous.info`         |

### 6. Default environment priority

When no explicit `APEX_DOMAIN` or `KC_HOSTNAME` is set:

- **Compose defaults** use `dev` (backward compatible, project name `dev`)
- **Tilt defaults** use `dev.localhost`
- **Production deployment** sets `KC_HOSTNAME=https://aldous.info/kc` and `APEX_DOMAIN=aldous.info`

## Rationale

**.localhost TLD:** RFC 6761 reserves `.localhost` as a special-use domain that always resolves to `127.0.0.1`. This is supported by every major OS, browser, and HTTP library. Unlike `localtest.me` or `lvh.me` (third-party DNS), `.localhost` requires zero infrastructure or registration. Caddy v2 also respects `.localhost` for virtual host routing without additional config.

**`dev.localhost` and `test.localhost` rather than just `localhost`:** A plain `localhost` does not support subdomain routing (`*.localhost` is technically valid but poorly supported in practice). Using `dev.localhost` and `test.localhost` as apex domains gives us predictable wildcard subdomain support (`*.dev.localhost`, `*.test.localhost`) that works identically to the production `*.aldous.info` pattern. Two separate `.localhost` domains allow dev and test to run against separate Keycloak configurations on the same local stack.

**APEX_DOMAIN as the single environment switch:** The tenant resolver, Caddy routing, and Keycloak URL derivation all derive from the APEX_DOMAIN value. Changing one env var switches the entire environment's domain convention.

## Consequences

**Positive:**

- Developers run `tilt up` with zero setup — no `/etc/hosts`, no DNS, no environment file editing.
- Multi-tenant dev works immediately: `tenant1.dev.localhost`, `tenant2.dev.localhost`, etc.
- Same Docker images (Caddy, platform-api) work in all environments — only env vars differ.
- Dynamic tenant provisioning works identically across all environments.
- Backward compatible — existing `localhost` and `aldous.info` configurations continue to work.

**Negative:**

- KC_HOSTNAME and APEX_DOMAIN must be set correctly in each environment. Incorrect values cause token issuer mismatches.
- Caddy config is static — wildcard blocks for both `.aldous.info` and `.localhost` means the Docker image has both sets of virtual hosts. Unused blocks in production are harmless but add config weight.
- Developers must type `.localhost` URLs (`dev.localhost` instead of `localhost`). This is mitigated by Tilt UI links and browser bookmarks.

**Operational:**

- Environment variable validation (fail-fast on startup if KC_HOSTNAME doesn't match APEX_DOMAIN) is recommended but not required — the platform mostly autodetects from request headers.
- Infra env terraform configs (development, test, staging, production) must include `kc_hostname` and `apex_domain` variables.

## AI-assistance record

AI used: Yes

- Tool/model: DeepSeek V4 Flash
- Assistance scope: ADR drafting
- Human review status: Reviewed by architecture owner

## Validation / evidence

Evidence level: Decision — implementation evidence in Caddyfile, Tiltfile, compose.yaml, and Makefile targets.

## Impacted areas

- Routing: Caddyfile — add `.localhost` virtual host blocks; extract handler snippets to avoid duplication
- Tiltfile: set `APEX_DOMAIN=dev.localhost` and derived env vars for dev mode
- compose.yaml: document environment-aware KC_HOSTNAME defaults; no functional change
- .env.example: add dev/test/prod environment profile sections
- Makefile: add `make dev-up`, `make test-up`, `make prod-up` targets
- Infra: add `kc_hostname` and `apex_domain` variables to keycloak module and env configs
- Tenant resolver: no code changes needed (already env-var-driven)
- Documentation: ACTION-REGISTER.md — track implementation actions

## Follow-up actions

Follow-up actions tracked in `docs/adr/ACTION-REGISTER.md`.

## Review date

2026-08-30

## Supersedes

None. Extends ADR-0029 (multi-tenant isolation boundaries) and ADR-0027 (Tilt local development feedback loop).

## Superseded by

None.

## References

- RFC 6761: Special-Use Domain Names (`.localhost`)
- ADR-0022: Authentication, session, and SSO integration boundary
- ADR-0023: Declarative infrastructure provisioning model
- ADR-0027: Tilt local development feedback loop
- ADR-0029: Multi-tenant isolation boundaries
- ADR-0032: E2E testing strategy
- Caddy `.localhost` support: [caddyserver.com/docs/automatic-https](https://caddyserver.com/docs/automatic-https)
