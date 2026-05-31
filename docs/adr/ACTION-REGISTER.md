# ADR Action Register

This register coordinates material follow-up actions created by ADRs.

It is the single source of truth for ADR-driven follow-up work.

Every action must include a `Source ADR` value.

It is not an ADR.

It does not consume an ADR number.

It is the architecture-facing index of ADR-driven work.

ADRs remain the decision history.

This register tracks the work required to validate, implement, supersede, or operationalise those decisions.

## Status values

```text
Open
In Progress
Blocked
Done
Deferred
Superseded
```

## Source ADR values

Use an accepted or proposed ADR identifier for decision-created work.

Examples:

```text
ADR-0001
ADR-0002
ADR-0003
ADR-0004
ADR process
```

Use `ADR process` only for actions that maintain the ADR system itself, such as the README, template, or action register.

## Action types

```text
ADR
Implementation
Validation
Documentation
Governance
Tooling
CI
Review
```

## Current decision sequence

The governance baseline (ADRs 0001?0015) is complete. The current sequence tracks what comes next.

```text
1. ADR-ACT-0015: Done ? ADR-0028 created for GraphQL schema boundary governance.
2. ADR-ACT-0008: Done ? authenticated organisation profile slice delivered and validated.
3. ADR-ACT-0037: Done ? vocabulary validated against all 8 reference systems; evidence in docs/evidence/architecture/package-metadata-vocabulary-validation.md.
4. ADR-ACT-0023: Done as ADR-0006.
5. ADR-ACT-0024: Deferred ? future optimisation after package graph grows.
```

Rationale:

```text
The governance baseline (ADRs 0001?0028) is complete. All structural, metadata, lifecycle, tooling, data-ownership, quality-gate, identity, auth, infrastructure, E2E, i18n, Tilt, and GraphQL-boundary ADRs are Accepted.

The first vertical slice (authenticated organisation profile) is complete: ADR-ACT-0008 Done.

Metadata vocabulary (ADR-ACT-0037) has been validated and documented. ADR-0005 can be formally considered complete.

ADR-0028 defines GraphQL schema boundary governance (ADR-ACT-0015 Done).

ADR-0029 defines multi-tenant isolation boundaries: schema-per-tenant + RLS, per-tenant Keycloak realm, identity brokering (external IdP + cross-tenant), FQDN-based routing, per-tenant theming, Redis ACL, S3 bucket policy isolation.

ADR-0030 defines dynamic authorisation and tenant admin self-service: Keycloak Authorization Services (UMA/PEP pattern), per-resource runtime-configurable policies, tenant admin realm self-service via Auth Settings API, sysadmin cross-domain brokering, and hexagonal package design for AuthorisationPort + RealmAdminPort + adapters.

Remaining open items are either blocked on external dependencies (Sonar CI secrets) or future-gated (after more vertical slices, before package publication).
```

Completed sequence items (governance baseline):

```text
ADR-ACT-0022: Done as ADR-0004.
ADR-ACT-0026: Done as ADR-0005.
ADR-ACT-0029: Done as ADR-0006.
ADR-ACT-0049: Done as ADR-0007.
ADR-ACT-0035: Done as ADR-0008.
ADR-ACT-0057: Done as ADR-0009.
ADR-ACT-0060: Done as ADR-0010.
ADR-ACT-0065: Done as ADR-0011.
ADR-ACT-0069: Done as ADR-0012.
ADR-ACT-0014: Done ? import-boundary rules documented and enforced.
ADR-ACT-0004: Done as ADR-0013.
ADR-ACT-0005: Done as ADR-0014.
ADR-ACT-0006: Done as ADR-0015.
ADR-ACT-0019: Done as ADR-0011.
ADR-ACT-0009: Done ? CI baseline in .github/workflows/ci.yml.
ADR-ACT-0053: Done ? ci.yml runs orchestrator all --no-reports.
ADR-ACT-0080: Done ? TypeScript AST scanner; --strict mode (cycle detection, unresolved relative/platform imports, computed dynamic); ImportTypeNode; import-boundary-rules.json; CI runs --strict.
ADR-ACT-0081: Done ? Wired package-map.mjs (buildPackageMap) into index.mjs replacing discoverKnownPackages; added no-architecture-in-product universal rule; new fixture; reporter updated.
```

## Register

| ID           | Source ADR | Action                                                                                                                                                                                                                                                                                                                                                                                                                                      | Type           | Status   | Priority | Depends on                           | Owner                               | Target / Review                                   | Evidence                                                                                                                                             |
| ------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------- | -------- | ------------------------------------ | ----------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-ACT-0016 | ADR-0002   | Review context names after the first five vertical slices.                                                                                                                                                                                                                                                                                                                                                                                  | Review         | Open     | Medium   | Five completed vertical slices       | Architecture owner / product owner  | After five vertical slices                        |                                                                                                                                                      |
| ADR-ACT-0024 | ADR-0003   | Define affected-package CI workflow to avoid unnecessary full CI for isolated changes.                                                                                                                                                                                                                                                                                                                                                      | ADR            | Deferred | High     | ADR-0003, ADR-ACT-0022, ADR-ACT-0026 | Architecture owner / technical lead | After first vertical slice                        | CI baseline runs all checks on every PR; affected-package selective CI is a future optimisation once the package graph is larger                     |
| ADR-ACT-0032 | ADR-0004   | Define third-party stakeholder explanation for lifecycle stage, package role, and semver expectations.                                                                                                                                                                                                                                                                                                                                      | Documentation  | Open     | Medium   | ADR-0004, ADR-ACT-0026               | Architecture owner / technical lead | Before releaseable package publication            |                                                                                                                                                      |
| ADR-ACT-0038 | ADR-0005   | Define generated outputs from package.json architecture metadata for README, Backstage catalog, Nx tags, C4 inventory, and runtime/deployment metadata where needed.                                                                                                                                                                                                                                                                        | ADR            | Open     | Medium   | ADR-0005, ADR-ACT-0033, ADR-ACT-0034 | Architecture owner / technical lead | Before generated-output tooling                   |                                                                                                                                                      |
| ADR-ACT-0039 | ADR-0005   | Add cross-ADR vocabulary consistency checks to the ADR review process.                                                                                                                                                                                                                                                                                                                                                                      | Governance     | Open     | Medium   | ADR-0001, ADR-0005                   | Architecture owner / technical lead | Before accepting future vocabulary-affecting ADRs |                                                                                                                                                      |
| ADR-ACT-0075 | ADR-0012   | If a TUI is implemented, add parity tests proving each TUI action maps to an orchestrator command and evidence output.                                                                                                                                                                                                                                                                                                                      | Validation     | Deferred | Medium   | ADR-0012, ADR-0011, ADR-ACT-0067     | Architecture owner / technical lead | Before TUI review                                 | No TUI exists in the repo; revisit only if a TUI is introduced.                                                                                      |
| ADR-ACT-0089 | ADR-0017   | Validate or replace the experimental local Sentry profile before adapter-sentry first use. The sentry profile (sentry-web, sentry-worker, sentry-cron) is for SDK smoke testing only and has not been validated end-to-end. Worker and cron services have no HTTP healthchecks (process-only liveness). Must be validated or replaced with an external Sentry/Grafana Cloud reference before @platform/adapters-sentry integration testing. | Validation     | Deferred | Medium   | ADR-0017, ADR-ACT-0087               | Architecture owner / technical lead | Before adapter-sentry first use                   | Current repo does not require adapter-sentry integration testing; profile remains experimental and may be revisited when first used.                 |
| ADR-ACT-0092 | ADR-0016   | Wire SonarQube quality gate into CI once SONAR_HOST_URL and SONAR_TOKEN are available as repository secrets. Until then, Sonar is a required local pre-slice gate with committed evidence.                                                                                                                                                                                                                                                  | Infrastructure | Blocked  | Medium   | ADR-0016, ADR-ACT-0091               | Architecture owner / technical lead | After Sonar CI secrets configured                 | Blocked: requires SONAR_HOST_URL and SONAR_TOKEN as repository CI secrets. Sonar gate runs locally via make all and evidence is committed per slice. |
| ADR-ACT-0090 | ADR-0016   | Add automated license policy scanner after dependency baseline stabilises. Current license:policy script is documentation-only (no enforcement). Options: license-checker npm, licensee, or FOSSA. Integrate as report-only gate first, then promote to hard after first vertical slice. Policy already documented at docs/security/license-policy.md.                                                                                      | Infrastructure | Open     | Low      | ADR-0016, ADR-ACT-0086               | Architecture owner / technical lead | After first vertical slice                        |                                                                                                                                                      |
| ADR-ACT-0086 | ADR-0016   | Wire license:check gate. Identify and integrate a stable license scanning CLI tool (license-checker or equivalent). Promote to hard gate after first vertical slice. License policy documented at docs/security/license-policy.md.                                                                                                                                                                                                          | Infrastructure | Open     | Low      | ADR-0016                             | Architecture owner                  | Not started                                       | Deferred until post-first-slice.                                                                                                                     |

| ADR-ACT-0141 | ADR-0001, ADR-0014 | Migrate IdentityRepository and OrganisationRepository port interfaces from packages/adapters-postgres/src/ports.ts to a domain or contract package. Currently in the adapter layer as a pragmatic baseline decision (ADR-0014). Should move to packages/contracts-identity (new) or packages/domain-identity when the next identity slice lands. | Implementation | Open | Medium | ADR-0001, ADR-0014, ADR-0021 | Architecture owner / technical lead | Before next identity vertical slice | ? |
| ADR-ACT-0143 | ADR-0029, ADR-0030 | Implement hierarchical tenant admin provisioning. Tenant-admin at {slug}.aldous.info must have self-service provisioning of: user accounts, groups, sub-organisations, feature modules, IdP integrations, resource policies ? all data-driven, no deployment. Requires: (1) POST /api/admin/\* routes gated by Keycloak UMA policies, (2) Keycloak fine-grained admin permissions for group-admin delegation, (3) tenant admin section in the universal SPA at {slug}.aldous.info/admin. | Implementation | Open | High | ADR-0029, ADR-0030, ADR-ACT-0142 | Architecture owner / technical lead | After ADR-ACT-0142 (tenant provisioning API) | ? |
| ADR-ACT-0145 | ADR-0030 | UMA ticket evaluation in BFF pipeline ? store access token in SessionRecord, call KeycloakAuthorisationAdapter.checkAccess() in pipeline per-resource check; replace static requiredPermission with resource+scope tuples. Requires session-runtime schema change + refresh token handling. | Implementation | Open | Critical | ADR-0030 | Architecture owner / technical lead | After Keycloak login confirmed working | ? |
| ADR-ACT-0147 | ADR-0029 | RLS policies ? In Progress. Migration 004 scoped to data tables (memberships, users, external_identities, tenant_resource_config); public.organisations excluded (routing-essential pre-session lookup). withTenant() now sets app.current_tenant_id. PostgresIdentityRepository retrofitted to use withSystemAdmin. CAVEAT: RLS is currently non-enforcing in dev because POSTGRES_USER creates a superuser; enforcement requires a non-superuser production DB role (ADR-ACT-0153). | Implementation | In Progress | High | ADR-0029 | Architecture owner / technical lead | After ADR-ACT-0153 | apps/platform-api/src/db/migrations/004-rls-policies.sql, packages/adapters-postgres/src/index.ts |
| ADR-ACT-0151 | ADR-0030 | Keycloak resource policy management (getResourcePolicy/setResourcePolicy) ? currently NOOP stubs in KeycloakRealmAdminAdapter. Implement via Keycloak Authorization Services API when Authorization Services are enabled on the BFF client. Blocked on ADR-ACT-0145. | Implementation | Open | Medium | ADR-0030 | Architecture owner / technical lead | After ADR-ACT-0145 | packages/adapters-keycloak/src/index.ts |
| ADR-ACT-0154 | ADR-0030, ADR-0031 | Persistent audit emission for Auth Settings API mutations. POST /api/auth/settings/idps, PATCH /api/auth/settings/mfa, PATCH /api/auth/settings/session, PATCH /api/auth/settings/sysadmin-brokering currently validate bodies and call Keycloak Admin API but do not emit AuditEvents. ADR-0030 ?1b requires auditability of auth setting changes. Blocked on ADR-ACT-0148 (persistent audit store) ? emitting to the in-memory port is insufficient for compliance. Implement once ClickHouse or Postgres-backed AuditEventPort is wired. | Implementation | Open | High | ADR-0030, ADR-0031 | Architecture owner / technical lead | Before tenant-admin UI release | apps/platform-api/src/server/routes.ts (auth settings handlers) |
| ADR-ACT-0156 | ADR-0029 | Keycloak login page theming. The Keycloak login page for the platform realm uses the default Keycloak theme. A custom theme matching the platform branding (logo, colours, font) should be applied as a Keycloak theme JAR or theme provider. Deferred pending Keycloak theme development workflow setup. | Implementation | Open | Medium | ADR-0029 | Architecture owner / technical lead | Before public-facing tenant login | infra/modules/keycloak/ |
| ADR-ACT-0157 | ADR-0029, ADR-0030 | OIDC and SAML broker login E2E. The platform realm supports identity brokering (ADR-0029 ?2b) but no OIDC or SAML IdP is currently configured in the local fixture. Tests in aldous-auth-negative.spec.ts are skipped pending provisioning. To implement: add an OIDC test IdP (e.g. mock OIDC server) to the Keycloak Terraform fixture; wire test user; add E2E assertions. | Implementation | Open | Medium | ADR-0029, ADR-0030 | Architecture owner / technical lead | Before OIDC broker announcement | infra/modules/keycloak/main.tf |
| ADR-ACT-0158 | ADR-0030 | MFA-required login E2E. The platform realm MFA policy defaults to optional. Tests in aldous-auth-negative.spec.ts are skipped. To implement: configure OTP policy on a test fixture user or realm; add E2E assertion that MFA challenge is presented; add assertion that bypass is rejected. | Implementation | Open | Medium | ADR-0030 | Architecture owner / technical lead | Before MFA announcement | infra/modules/keycloak/main.tf |
| ADR-ACT-0159 | ADR-0022 | Disabled user and unverified email E2E. Tests in aldous-auth-negative.spec.ts are skipped. To implement: add a disabled fixture user and an email_verified=false fixture user to Keycloak Terraform; assert login is rejected with appropriate Keycloak error. Note: current realm has verify_email=false so all users are considered verified. | Implementation | Open | Low | ADR-0022 | Architecture owner / technical lead | After ADR-ACT-0155 | infra/modules/keycloak/main.tf |
| ADR-ACT-0160 | ADR-0022 | Expired session E2E. Tests in auth-negative.spec.ts are skipped. To implement: shorten token/session lifetime in test realm config; wait for expiry; assert /api/session returns 401. Requires either time manipulation or very short test lifetimes. | Implementation | Open | Low | ADR-0022 | Architecture owner / technical lead | After ADR-ACT-0155 | ? |
| ADR-ACT-0162 | ADR-0030, ADR-0031 | Vanity domain runtime support. When a tenant configures a custom domain (e.g. app.theirdomain.com), the platform must call the Keycloak Admin API via the Auth Settings API to add the vanity domain to the tenant's realm BFF client redirect_uris and web_origins at runtime ? no Terraform apply required. Requires: Auth Settings API proxy endpoint (/api/auth/settings/domains) + platform-provisioner service account in tenant realm. | Implementation | Open | High | ADR-0030, ADR-0031 | Architecture owner | After ADR-ACT-0145 | ? |

| ADR-ACT-0181 | ADR-0021, ADR-0022 | Keycloak mapper deployment guard. ADR-ACT-0179 introduced a deployment ordering dependency: resolveSessionFromIdentity() derives system-admin from identity.realmRoles, which is only populated if the bff_realm_roles_userinfo Keycloak protocol mapper has been applied via keycloak-provision. If the mapper is absent, system-admin users silently get roles:[] with no startup error. Add a startup check (or readiness probe assertion) that verifies the mapper is present on the BFF client before accepting traffic in production. | Implementation | Open | Medium | ADR-ACT-0179 | Architecture owner / technical lead | After keycloak-provision is stable | apps/platform-api/src/server/ (startup validator) or readyz extension |

| ADR-ACT-0182 | ADR-0029, ADR-0030, ADR-0031 | pgAdmin sysadmin-only RLS-aware connection. pgAdmin is sysadmin-only: pgadmin_sysadmin is a non-superuser Postgres role with app.bypass_rls=true default, matching withSystemAdmin() in the platform-api. admin:pgadmin is in SYSTEM_ADMIN_RESOURCES only — NOT in TENANT_ADMIN_RESOURCES. Tenant-admin pgAdmin access is blocked because app.current_tenant_id and app.bypass_rls are user-settable GUCs: any connection holder can override them to access cross-tenant data (see ADR-ACT-0184 for the role-membership bypass fix that would make tenant-scoped pgAdmin safe). Single pre-configured server entry in servers.json for the pgadmin_sysadmin role. | Implementation | Done | High | ADR-ACT-0155, ADR-ACT-0179 | Architecture owner / technical lead | Complete | docker/pgadmin/servers.json; docker/postgres/init-extra-databases.sh; forward-auth.ts SYSTEM_ADMIN_RESOURCES only |

| ADR-ACT-0184 | ADR-0029, ADR-0031 | Replace GUC-based RLS bypass with role-membership check. Current implementation uses app.bypass_rls (a user-settable custom GUC) as the bypass switch in RLS policies. Any connection holder can SET app.bypass_rls = 'true' to bypass all row security — exploitable in pgAdmin where users execute arbitrary SQL. Fix: (1) create an rls_bypass Postgres role; (2) grant it to pgadmin_sysadmin and the platform-api connection role; (3) update migration 004-rls-policies.sql to check pg_has_role(current_user, 'rls_bypass', 'MEMBER') instead of the GUC; (4) remove SET LOCAL app.bypass_rls from withSystemAdmin() in adapters-postgres. Until this lands, tenant-admin pgAdmin access must remain blocked (admin:pgadmin absent from TENANT_ADMIN_RESOURCES). | Implementation | Open | Critical | ADR-ACT-0182 | Architecture owner / technical lead | Before tenant-admin pgAdmin access | packages/adapters-postgres/src/index.ts; apps/platform-api/src/db/migrations/; docker/postgres/init-extra-databases.sh |

| ADR-ACT-0183 | ADR-0030, ADR-0022 | Keycloak SSO for admin tool UIs. pgAdmin (OAuth2/PKCE) and MinIO (OpenID Connect) are configured to authenticate via the platform Keycloak realm. After a user authenticates to the platform, clicking through to /pgadmin/ or /minio/ triggers an OIDC redirect to Keycloak which recognises the existing session and auto-authenticates (no re-login). Keycloak clients registered: pgadmin (public PKCE), minio (public PKCE). config-local.py implements Flask-Security OAuth2 integration reading KEYCLOAK-URL/KC-HOSTNAME/KEYCLOAK-REALM from compose env. MinIO IDENTITY-OPENID env vars point at the Keycloak realm discovery endpoint. Services without SSO support: Mailpit, ClickHouse Play, WireMock (no auth mechanism); SonarQube Community (OIDC requires paid plugin — open ADR-ACT item); Sentry 9.x (SAML complex — deferred). | Implementation | Done | Medium | ADR-ACT-0155 | Architecture owner / technical lead | Complete | infra/modules/keycloak/main.tf (pgadmin + minio clients); docker/pgadmin/config-local.py; compose.yaml MinIO IDENTITY-OPENID |

## Notes

Actions may later link to tickets, pull requests, issues, or delivery-board items.

When an action is completed, update the status and evidence column.

If an ADR is superseded, review all open actions sourced from that ADR.

ADR-ACT-0081 deliberately did not complete TypeScript compiler module resolution. It completed package-map based internal package awareness and architecture-tooling isolation. ADR-ACT-0082 owns the full resolver.
