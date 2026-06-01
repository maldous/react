# Cross-ADR Vocabulary Consistency (ADR-ACT-0039)

Defines the canonical vocabulary used across all ADRs and how consistency is maintained.

## Canonical terms

| Term                   | Definition                                                                                            | Used in                |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------- |
| **Tenant**             | A top-level organisation with its own Keycloak realm, DB schema, Redis namespace, S3 bucket (Tier 1)  | ADR-0029, 0030, 0031   |
| **Sub-organisation**   | A logical child organisation sharing the parent's infrastructure (Tier 2 — same realm, schema, cache) | ADR-0029, ADR-ACT-0143 |
| **Feature module**     | A named platform capability toggleable per-tenant without deployment; stored in `tenant_settings`     | ADR-ACT-0143           |
| **UMA**                | User-Managed Access — Keycloak's policy enforcement mechanism for fine-grained authorisation          | ADR-0030               |
| **BFF**                | Backend For Frontend — the `platform-api` server acting as the API boundary for the React SPA         | ADR-0022, 0030         |
| **Audit-first**        | Pattern: emit audit event before mutation; if audit fails, mutation does not run                      | ADR-ACT-0154           |
| **RLS**                | Row-Level Security — PostgreSQL row filtering by tenant context (`app.current_tenant_id`)             | ADR-0029, ADR-ACT-0147 |
| **Tier 1**             | Top-level tenant with dedicated Keycloak realm + DB schema + Redis ACL + S3 bucket                    | ADR-0031               |
| **Tier 2**             | Sub-organisation sharing parent's infrastructure; identity boundary = Keycloak group                  | ADR-0031               |
| **FQDN tenant**        | A tenant accessed via its subdomain `{slug}.aldous.info` (vs apex host `aldous.info`)                 | ADR-0029               |
| **Scope (route)**      | `"global"` = apex host only; `"tenant"` = tenant FQDN only; enforced by pipeline                      | ADR-0029               |
| **requiredPermission** | Static session-resolved permission for degraded-mode fallback when UMA is unavailable                 | ADR-0030, ADR-ACT-0145 |
| **platform_app**       | Non-superuser Postgres role used at runtime; subject to RLS                                           | ADR-ACT-0189           |
| **rls_bypass**         | NOLOGIN role granted to `platform_app`; enables `withSystemAdmin()` via `SET LOCAL ROLE`              | ADR-ACT-0184, 0189     |

## Review process

New vocabulary-affecting ADRs must:

1. Define all new terms in the ADR body before first use.
2. Check this document for conflicts with existing definitions.
3. Add or update terms here as part of the ADR acceptance (before merging).

No automated tooling is required at this stage. This document is the
human-readable reference that reviewers check when accepting new ADRs.

## Naming conventions

- **Route permissions** follow `<scope>.<resource>.<action>` — e.g. `tenant.members.delete`, `platform.tenants.create`
- **UMA resources** follow `<namespace>:<resource>` — e.g. `organisation:members`, `admin:tenants`
- **Audit actions** follow `<resource>.<past_verb>` — e.g. `member.invited`, `group.created`
- **DB migration files** follow `NNN-<slug>.sql` with zero-padded sequential number
