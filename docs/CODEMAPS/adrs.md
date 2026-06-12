# ADRs Codemap

**Last Updated:** 2026-06-11

51 Architecture Decision Records (ADR-0001 through ADR-0051). ADR-0018 is intentionally absent. All status: **Accepted**.

## Foundation & Governance (8)

| ID       | Title                                                          | Date       | File                                                                   |
| -------- | -------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| ADR-0001 | Use modular hexagonal architecture                             | 2026-05-26 | 0001-use-modular-hexagonal-architecture.md                             |
| ADR-0002 | Model the platform around bounded contexts                     | 2026-05-26 | 0002-model-the-platform-around-bounded-contexts.md                     |
| ADR-0003 | Use a modular monorepo with promotion-ready package boundaries | 2026-05-26 | 0003-use-a-modular-monorepo-with-promotion-ready-package-boundaries.md |
| ADR-0004 | Define package lifecycle classes                               | 2026-05-26 | 0004-define-package-lifecycle-classes.md                               |
| ADR-0005 | Define package metadata vocabulary and format                  | 2026-05-26 | 0005-define-package-metadata-format.md                                 |
| ADR-0006 | Define package lifecycle transition rules                      | 2026-05-26 | 0006-define-package-lifecycle-transition-rules.md                      |
| ADR-0007 | Define architecture artifact and repository directory layout   | 2026-05-26 | 0007-define-architecture-artifact-and-repository-directory-layout.md   |
| ADR-0008 | Define generated package README structure                      | 2026-05-26 | 0008-define-generated-package-readme-structure.md                      |

## Architecture Tooling (4)

| ID       | Title                                                                         | Date       | File                                                       |
| -------- | ----------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------- |
| ADR-0009 | Define package inventory and report structure                                 | 2026-05-26 | 0009-define-package-inventory-and-report-structure.md      |
| ADR-0010 | Define lifecycle transition evidence bundle format                            | 2026-05-26 | 0010-define-lifecycle-transition-evidence-bundle-format.md |
| ADR-0011 | Define architecture tooling execution model                                   | 2026-05-26 | 0011-define-architecture-tooling-execution-model.md        |
| ADR-0012 | Define architecture tooling test, validation, TUI, and self-evidence strategy | 2026-05-26 | 0012-define-architecture-tooling-test-strategy.md          |

## API & Data (4)

| ID       | Title                                                | Date       | File                                            |
| -------- | ---------------------------------------------------- | ---------- | ----------------------------------------------- |
| ADR-0013 | Define client-facing API boundary                    | 2026-05-27 | 0013-define-client-facing-api-boundary.md       |
| ADR-0014 | Define transactional data ownership                  | 2026-05-27 | 0014-define-transactional-data-ownership.md     |
| ADR-0015 | Define analytical data ownership                     | 2026-05-27 | 0015-define-analytical-data-ownership.md        |
| ADR-0016 | Define enterprise quality gate and security baseline | 2026-05-27 | 0016-define-enterprise-quality-gate-baseline.md |

## Local Development & Infrastructure (2)

| ID           | Title                                      | Date       | File                                               |
| ------------ | ------------------------------------------ | ---------- | -------------------------------------------------- |
| ADR-0017     | Define local integration service substrate | 2026-05-27 | 0017-define-local-integration-service-substrate.md |
| **ADR-0018** | **ABSENT** (intentional gap)               | —          | —                                                  |

## Product Verticals (13)

| ID       | Title                                                                   | Date       | File                                                                          |
| -------- | ----------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| ADR-0019 | Define React component platform and frontend integration stack          | 2026-05-28 | 0019-define-react-component-platform-and-frontend-integration-stack.md        |
| ADR-0020 | Define observability, diagnostics, and runtime introspection primitives | 2026-05-28 | 0020-define-observability-diagnostics-and-runtime-introspection-primitives.md |
| ADR-0021 | Define identity, tenancy, roles, and permissions model                  | 2026-05-28 | 0021-define-identity-tenancy-roles-and-permissions-model.md                   |
| ADR-0022 | Define authentication, session, and SSO integration boundary            | 2026-05-28 | 0022-define-authentication-session-and-sso-integration-boundary.md            |
| ADR-0023 | Define declarative infrastructure provisioning model                    | 2026-05-28 | 0023-define-declarative-infrastructure-provisioning-model.md                  |
| ADR-0024 | Define slice readiness and dependency gate model                        | 2026-05-28 | 0024-define-slice-readiness-and-dependency-gate-model.md                      |
| ADR-0025 | Define Playwright end-to-end testing strategy                           | 2026-05-28 | 0025-define-playwright-end-to-end-testing-strategy.md                         |
| ADR-0026 | Define internationalisation and translation resource model              | 2026-05-29 | 0026-define-internationalisation-and-translation-resource-model.md            |
| ADR-0027 | Define Tilt local development feedback loop                             | 2026-05-29 | 0027-define-tilt-local-development-feedback-loop.md                           |
| ADR-0028 | Define GraphQL schema boundary governance                               | 2026-05-29 | 0028-define-graphql-schema-boundary-governance.md                             |
| ADR-0029 | Define multi-tenant isolation boundaries                                | 2026-05-29 | 0029-define-multi-tenant-isolation-boundaries.md                              |
| ADR-0030 | Define dynamic authorisation and tenant admin self-service              | 2026-05-29 | 0030-define-dynamic-authorisation-and-tenant-admin-self-service.md            |
| ADR-0031 | Define infrastructure provisioning privilege model                      | 2026-05-29 | 0031-define-infrastructure-provisioning-privilege-model.md                    |

## Testing & Environment (3)

| ID       | Title                                                         | Date       | File                                                     |
| -------- | ------------------------------------------------------------- | ---------- | -------------------------------------------------------- |
| ADR-0032 | E2E Testing Strategy                                          | 2026-05-29 | 0032-e2e-testing-strategy.md                             |
| ADR-0033 | Define environment-specific domain and hostname configuration | 2026-05-30 | 0033-define-environment-specific-domain-configuration.md |
| ADR-0034 | Define per-environment test composition                       | 2026-05-30 | 0034-define-per-environment-test-composition.md          |

## Observability (1)

| ID       | Title                              | Date       | File                                       |
| -------- | ---------------------------------- | ---------- | ------------------------------------------ |
| ADR-0035 | Enterprise Log Indexing and Search | 2026-06-02 | 0035-enterprise-log-indexing-and-search.md |

## Tenant Administration & Identity (10)

| ID       | Title                                                           | Date       | File                                                              |
| -------- | --------------------------------------------------------------- | ---------- | ----------------------------------------------------------------- |
| ADR-0036 | Tenant Administration Control Plane                             | 2026-06-11 | 0036-tenant-administration-control-plane.md                       |
| ADR-0037 | Per-tenant Authentication Provider Configuration                | 2026-06-11 | 0037-per-tenant-authentication-provider-configuration.md          |
| ADR-0038 | Tenant Identity and Membership v2                               | 2026-06-11 | 0038-tenant-identity-and-membership-v2.md                         |
| ADR-0039 | Platform Configuration Registry                                 | 2026-06-11 | 0039-platform-configuration-registry.md                           |
| ADR-0040 | Administrative Audit Trail and Verification                     | 2026-06-11 | 0040-administrative-audit-trail-and-control-plane-verification.md |
| ADR-0041 | Per-tenant Auth Settings Credential Provisioning                | 2026-06-11 | 0041-per-tenant-auth-settings-credential-provisioning.md          |
| ADR-0042 | Writable MFA Policy and Auth Settings Runtime Proof             | 2026-06-11 | 0042-writable-mfa-policy-and-auth-settings-runtime-proof.md       |
| ADR-0043 | Writable Identity Provider Management with Secret Redaction     | 2026-06-11 | 0043-writable-idp-management-secret-redaction.md                  |
| ADR-0044 | Auth Settings Credential Lifecycle (Rotation, Repair, Recovery) | 2026-06-11 | 0044-auth-settings-credential-lifecycle.md                        |
| ADR-0045 | Enterprise Tenant Onboarding and Control-Plane Capability Map   | 2026-06-11 | 0045-enterprise-tenant-onboarding-capability-map.md               |
| ADR-0046 | OIDC Enterprise Hardening                                       | 2026-06-12 | 0046-oidc-enterprise-hardening.md                                 |
| ADR-0047 | Tenant Email Sender Configuration + Readiness                   | 2026-06-12 | 0047-tenant-email-sender-configuration.md                         |
| ADR-0048 | Tenant Custom Domains + DNS/TLS Readiness                       | 2026-06-12 | 0048-tenant-custom-domains.md                                     |
| ADR-0049 | Tenant Storage Readiness + Isolation Proof                      | 2026-06-12 | 0049-tenant-storage-readiness.md                                  |

---

## Key Dependency Edges

- **ADR-0027** → ADR-0011, ADR-0017, ADR-0023, ADR-0025, ADR-0026, ADR-0033 (Tilt/dev dependencies)
- **ADR-0028** → ADR-0001, ADR-0002, ADR-0013, ADR-0014 (GraphQL as API boundary)
- **ADR-0029** ↔ **ADR-0030** (Multi-tenant ↔ authorisation mutual dependency)
- **ADR-0020** → **ADR-0032** (Observability foundations → log backend)

## Governance

- All ADRs are **Accepted** (no superceded or pending)
- Next ADR: **ADR-0052**
- Action register: `docs/adr/ACTION-REGISTER.md`
- Lifecycle evidence: `docs/evidence/`

## Reading Path

1. Start: ADR-0001 (hexagonal architecture)
2. Then: ADR-0002, ADR-0003, ADR-0004, ADR-0005 (package/bounded context model)
3. Then: ADR-0013 (API boundary), ADR-0020 (observability)
4. Product verticals: ADR-0019 (React), ADR-0021 (identity), ADR-0022 (auth), ADR-0029 (multi-tenant)
