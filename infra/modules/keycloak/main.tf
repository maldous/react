# ---------------------------------------------------------------------------
# Keycloak provisioning module ? ADR-ACT-0110
#
# Provisions:
#   - realm
#   - SPA client (public, PKCE) for future direct-SPA flows
#   - BFF/API client (confidential) for Authorization Code + PKCE (ADR-0022)
#   - platform-claims client scope with organisationId mapper
#   - realm roles matching ADR-0021 (system-admin, tenant-admin, manager, member, viewer)
#   - fixture test users with role assignments (local/dev only)
#
# What this module does NOT manage:
#   - Database schema (owned by application migrations)
#   - Application fixture data (owned by seed scripts in platform-api)
#   - Production users (never provisioned here)
#   - Cloud infrastructure (AWS modules)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Realm
# ---------------------------------------------------------------------------

resource "keycloak_realm" "platform" {
  realm        = var.realm_name
  enabled      = true
  display_name = var.realm_display_name

  # Custom login theme (ADR-ACT-0157): bounces brokered-IdP failures back to the app
  # /login so Keycloak stays invisible to end users. Mounted into the KC container at
  # /opt/keycloak/themes/platform (see compose.yaml keycloak volume).
  login_theme = "platform"

  # Token lifetimes suitable for local development and CI
  access_token_lifespan                = "15m"
  sso_session_idle_timeout             = "30m"
  sso_session_max_lifespan             = "10h"
  offline_session_idle_timeout         = "720h"
  offline_session_max_lifespan_enabled = false

  # Login settings
  registration_allowed     = false
  remember_me              = false
  reset_password_allowed   = true
  verify_email             = false
  login_with_email_allowed = true
  duplicate_emails_allowed = false

}

# Event logging ? kept in memory; visible in Keycloak admin console Events tab.
# Moved out of keycloak_realm (provider v4.4 uses separate resource).
resource "keycloak_realm_events" "platform" {
  realm_id                     = keycloak_realm.platform.id
  events_enabled               = true
  events_expiration            = 86400
  admin_events_enabled         = true
  admin_events_details_enabled = true
}

# ---------------------------------------------------------------------------
# Realm roles ? ADR-0021
# ---------------------------------------------------------------------------

resource "keycloak_role" "system_admin" {
  realm_id    = keycloak_realm.platform.id
  name        = "system-admin"
  description = "Full access across all tenants. Not assignable via product UI (ADR-0021)."
}

resource "keycloak_role" "tenant_admin" {
  realm_id    = keycloak_realm.platform.id
  name        = "tenant-admin"
  description = "Full control within the organisation. Manages members and settings (ADR-0021)."
}

resource "keycloak_role" "manager" {
  realm_id    = keycloak_realm.platform.id
  name        = "manager"
  description = "Can manage members below their level; cannot change org settings (ADR-0021)."
}

resource "keycloak_role" "member" {
  realm_id    = keycloak_realm.platform.id
  name        = "member"
  description = "Standard access to product features (ADR-0021)."
}

resource "keycloak_role" "viewer" {
  realm_id    = keycloak_realm.platform.id
  name        = "viewer"
  description = "Read-only access. Cannot perform write operations (ADR-0021)."
}

# ---------------------------------------------------------------------------
# SPA client ? public, PKCE, no client secret
#
# Provisioned for future direct-SPA flows (e.g. admin console, alternative
# auth patterns). The current ADR-ACT-0008 slice uses fixture sessions and
# does not use this client yet.
# ---------------------------------------------------------------------------

resource "keycloak_openid_client" "spa" {
  realm_id  = keycloak_realm.platform.id
  client_id = var.spa_client_id
  name      = "Platform SPA"
  enabled   = true

  access_type                  = "PUBLIC"
  standard_flow_enabled        = true
  implicit_flow_enabled        = false
  direct_access_grants_enabled = false

  # PKCE required for public clients (OAuth 2.1)
  pkce_code_challenge_method = "S256"

  valid_redirect_uris = var.spa_redirect_uris
  web_origins         = var.spa_web_origins
}

# ---------------------------------------------------------------------------
# BFF/API client ? confidential, PKCE
#
# The platform-api BFF handles the entire OAuth callback flow (ADR-0022):
#   React app ? /auth/login ? BFF ? Keycloak ? BFF callback
#   BFF exchanges code for tokens, writes SessionActor to Redis session.
#   React app receives only safe SessionActor JSON from /api/session.
# ---------------------------------------------------------------------------

resource "keycloak_openid_client" "bff" {
  realm_id  = keycloak_realm.platform.id
  client_id = var.bff_client_id
  name      = "Platform BFF/API"
  enabled   = true

  access_type                  = "CONFIDENTIAL"
  standard_flow_enabled        = true
  implicit_flow_enabled        = false
  direct_access_grants_enabled = false
  service_accounts_enabled     = true # Required for Authorization Services (ADR-ACT-0145)

  # Keycloak Authorization Services (UMA 2.0) — ADR-ACT-0145
  # Enables runtime per-resource policy evaluation via UMA ticket endpoint.
  # The BFF calls POST /realms/{realm}/protocol/openid-connect/token with
  # grant_type=urn:ietf:params:oauth:grant-type:uma-ticket on each request.
  authorization {
    policy_enforcement_mode          = "ENFORCING"
    decision_strategy                = "AFFIRMATIVE"
    allow_remote_resource_management = true
  }

  # PKCE as additional security layer even for confidential clients
  pkce_code_challenge_method = "S256"

  client_secret = var.bff_client_secret

  # BFF callback endpoints — the BFF exchanges code at the server, not the browser.
  # Generated from kc_hostname and apex_domain for environment-appropriate redirect URIs.
  # Override via bff_redirect_uris variable if custom URIs are needed.
  # Note: "+" would allow all valid redirect URIs; we use explicit list for security.
  valid_redirect_uris = var.bff_redirect_uris
  web_origins         = ["+"]

  # Keycloak RP-Initiated Logout (RFC 7591) — required so post_logout_redirect_uri
  # is accepted when platform-api redirects to the KC end_session endpoint.
  # "+" matches all valid_redirect_uris; explicit list also accepted.
  valid_post_logout_redirect_uris = [
    "https://${var.apex_domain}/*",
    "http://${var.apex_domain}/*",
    "http://localhost/*",
    "http://dev.localhost/*",
    "http://test.localhost/*",
    "https://*.${var.apex_domain}/*",
  ]
}

# ---------------------------------------------------------------------------
# platform-provisioner service account ? ADR-0031
#
# Used by platform-api to create per-tenant Keycloak realms at runtime
# without a Terraform deployment. Requires the master-realm service account
# role that allows realm creation only (no server-admin privilege escalation).
#
# The provisioner credentials are stored in env vars:
#   KEYCLOAK_PROVISIONER_CLIENT_ID
#   KEYCLOAK_PROVISIONER_CLIENT_SECRET
# ---------------------------------------------------------------------------

resource "keycloak_openid_client" "provisioner" {
  realm_id  = "master"
  client_id = var.provisioner_client_id
  name      = "Platform Provisioner"
  enabled   = true

  access_type              = "CONFIDENTIAL"
  standard_flow_enabled    = false
  service_accounts_enabled = true

  client_secret = var.provisioner_client_secret
}

resource "keycloak_openid_client_service_account_realm_role" "provisioner_create_realm" {
  realm_id                = "master"
  service_account_user_id = keycloak_openid_client.provisioner.service_account_user_id
  # create-realm is a realm role in master ? allows dynamic tenant realm provisioning.
  # manage-realm is a client role (on master-realm client), not a realm role.
  role = "create-realm"
}


# ---------------------------------------------------------------------------
# platform-claims client scope ? organisationId claim mapper
#
# Adds organisationId to tokens via a user attribute.
# Fixture users have this attribute set to the fixture org UUID.
# Production users receive it from the adapters-keycloak claim mapping
# after the BFF resolves their active Membership.
#
# Attached as an optional scope so clients explicitly request it.
# Avoids using keycloak_openid_client_default_scopes (which replaces
# rather than appends, risking loss of built-in scopes).
# ---------------------------------------------------------------------------

resource "keycloak_openid_client_scope" "platform_claims" {
  realm_id    = keycloak_realm.platform.id
  name        = "platform-claims"
  description = "Platform-specific claims: organisationId (ADR-ACT-0110)"
}

resource "keycloak_openid_user_attribute_protocol_mapper" "organisation_id" {
  realm_id        = keycloak_realm.platform.id
  client_scope_id = keycloak_openid_client_scope.platform_claims.id
  name            = "organisation-id-mapper"

  user_attribute      = "organisationId"
  claim_name          = "organisationId"
  claim_value_type    = "String"
  add_to_id_token     = true
  add_to_access_token = true
  add_to_userinfo     = true
}

# ---------------------------------------------------------------------------
# Realm roles → /userinfo — ADR-ACT-0175
#
# Keycloak includes realm_access.roles in access tokens by default, but NOT
# in the /userinfo response. The platform-api BFF calls /userinfo (not the
# access token) to resolve identity claims, so realm roles are invisible to
# the session creation flow without this mapper.
#
# This mapper adds realm_access.roles to the /userinfo response for the BFF
# client only (not access token or id token — those already have it via the
# default realm-management mapper). Enables resolveSessionFromIdentity() to
# propagate the system-admin realm role into the platform session.
# ---------------------------------------------------------------------------

resource "keycloak_openid_user_realm_role_protocol_mapper" "bff_realm_roles_userinfo" {
  realm_id  = keycloak_realm.platform.id
  client_id = keycloak_openid_client.bff.id
  name      = "realm-roles-userinfo"

  claim_name          = "realm_access.roles"
  multivalued         = true
  add_to_id_token     = false
  add_to_access_token = false
  add_to_userinfo     = true
}

# ---------------------------------------------------------------------------
# SSO clients for admin tool UIs — pgAdmin and MinIO (ADR-0030)
#
# These are public PKCE clients so no client secret is needed (tools run on the
# same host and redirect back to the same origin). The BFF pattern is NOT used
# for admin tools — they handle their own OIDC flow directly with Keycloak.
# ---------------------------------------------------------------------------

# pgAdmin OAuth2 client — CONFIDENTIAL (ADR-0073). pgAdmin's authlib does a
# confidential code exchange with a client secret; a public/PKCE client failed the
# token exchange. The secret comes from the generated env (PGADMIN_OIDC_CLIENT_SECRET).
resource "keycloak_openid_client" "pgadmin" {
  realm_id  = keycloak_realm.platform.id
  client_id = "pgadmin"
  name      = "pgAdmin"
  enabled   = true

  access_type                  = "CONFIDENTIAL"
  standard_flow_enabled        = true
  implicit_flow_enabled        = false
  direct_access_grants_enabled = false

  client_secret = var.pgadmin_oidc_client_secret

  valid_redirect_uris = [
    "http://localhost:5050/pgadmin/oauth2/authorize",
    "http://${var.apex_domain}/pgadmin/oauth2/authorize",
    "https://${var.apex_domain}/pgadmin/oauth2/authorize",
  ]
  web_origins = ["+"]
}

# MinIO OIDC client — public, PKCE, Authorization Code flow
resource "keycloak_openid_client" "minio" {
  realm_id  = keycloak_realm.platform.id
  client_id = "minio"
  name      = "MinIO Console"
  enabled   = true

  access_type                  = "PUBLIC"
  standard_flow_enabled        = true
  implicit_flow_enabled        = false
  direct_access_grants_enabled = false

  pkce_code_challenge_method = "S256"

  valid_redirect_uris = [
    "http://localhost:9001/minio/oauth_callback",
    "http://localhost:9031/minio/oauth_callback",
    "http://${var.apex_domain}/minio/oauth_callback",
    "https://${var.apex_domain}/minio/oauth_callback",
  ]
  web_origins = ["+"]
}

# ---------------------------------------------------------------------------
# Fixture users ? local/dev environments only
#
# Emails match apps/platform-api/src/db/seed.ts exactly so that the
# adapters-keycloak ExternalIdentity lookup succeeds when real login is wired.
# organisationId attribute set to the fixture org UUID.
# Role assignments match the fixture session actors in session.ts.
#
# provision_fixture_users = false (default) prevents accidental staging/prod creation.
# ---------------------------------------------------------------------------

resource "keycloak_user" "admin" {
  count    = var.provision_fixture_users ? 1 : 0
  realm_id = keycloak_realm.platform.id
  username = "admin@fixture.local"
  email    = "admin@fixture.local"
  enabled  = true

  email_verified = true

  first_name = "Fixture"
  last_name  = "Admin"

  initial_password {
    value     = var.fixture_user_password
    temporary = false
  }

  attributes = {
    organisationId = "00000000-0000-0000-0000-000000000001"
  }
}

resource "keycloak_user" "viewer" {
  count    = var.provision_fixture_users ? 1 : 0
  realm_id = keycloak_realm.platform.id
  username = "viewer@fixture.local"
  email    = "viewer@fixture.local"
  enabled  = true

  email_verified = true

  first_name = "Fixture"
  last_name  = "Viewer"

  initial_password {
    value     = var.fixture_user_password
    temporary = false
  }

  attributes = {
    organisationId = "00000000-0000-0000-0000-000000000001"
  }
}

resource "keycloak_user" "forbidden" {
  count    = var.provision_fixture_users ? 1 : 0
  realm_id = keycloak_realm.platform.id
  username = "forbidden@fixture.local"
  email    = "forbidden@fixture.local"
  enabled  = true

  email_verified = true

  first_name = "Fixture"
  last_name  = "Forbidden"

  initial_password {
    value     = var.fixture_user_password
    temporary = false
  }

  # No organisationId attribute ? this user has no active membership (ADR-ACT-0008 no-membership fixture)
}

resource "keycloak_user_roles" "admin_roles" {
  count    = var.provision_fixture_users ? 1 : 0
  realm_id = keycloak_realm.platform.id
  user_id  = keycloak_user.admin[0].id

  role_ids = [keycloak_role.tenant_admin.id]
}

resource "keycloak_user_roles" "viewer_roles" {
  count    = var.provision_fixture_users ? 1 : 0
  realm_id = keycloak_realm.platform.id
  user_id  = keycloak_user.viewer[0].id

  role_ids = [keycloak_role.viewer.id]
}

# ---------------------------------------------------------------------------
# Super-global system-admin fixture user ? local/dev only
#
# Used by real-browser E2E login tests on aldous.info (playwright.real-auth.config.ts).
# Has system-admin realm role so forward_auth grants access to all admin tool routes.
# Email uses aldous.info domain to match the /api/session actor display.
# Never add this user to staging or production ? provision_fixture_users is false there.
# ---------------------------------------------------------------------------

resource "keycloak_user" "sysadmin" {
  count    = var.provision_fixture_users ? 1 : 0
  realm_id = keycloak_realm.platform.id
  username = "sysadmin@aldous.info"
  email    = "sysadmin@aldous.info"
  enabled  = true

  email_verified = true

  first_name = "Platform"
  last_name  = "SysAdmin"

  initial_password {
    value     = var.fixture_user_password
    temporary = false
  }
}

resource "keycloak_user_roles" "sysadmin_roles" {
  count    = var.provision_fixture_users ? 1 : 0
  realm_id = keycloak_realm.platform.id
  user_id  = keycloak_user.sysadmin[0].id

  role_ids = [keycloak_role.system_admin.id]
}

# ---------------------------------------------------------------------------
# Authorization resources and policies (UMA 2.0) — ADR-ACT-0145
#
# Defines protected resources managed by the BFF client's Authorization
# Services. Resources are evaluated at runtime with ENFORCING policy mode.
# Role-based policies grant system-admin access to global admin resources.
# ---------------------------------------------------------------------------

# admin:tenants — global tenant provisioning resource
resource "keycloak_openid_client_authorization_resource" "admin_tenants" {
  resource_server_id = keycloak_openid_client.bff.resource_server_id
  realm_id           = keycloak_realm.platform.id
  name               = "admin:tenants"
  display_name       = "Admin — Tenant Provisioning"
  scopes             = ["create", "read"]
}

# Role-based policy — system-admin role grants access
resource "keycloak_openid_client_role_policy" "system_admin" {
  resource_server_id = keycloak_openid_client.bff.resource_server_id
  realm_id           = keycloak_realm.platform.id
  name               = "system-admin-role-policy"
  description        = "Grants access to users with the system-admin realm role"
  type               = "role"
  logic              = "POSITIVE"
  decision_strategy  = "UNANIMOUS"

  role {
    id       = keycloak_role.system_admin.id
    required = true
  }
}

# Scope-based permissions — bind resource + scope to role policy
resource "keycloak_openid_client_authorization_permission" "admin_tenants_create" {
  resource_server_id = keycloak_openid_client.bff.resource_server_id
  realm_id           = keycloak_realm.platform.id
  name               = "admin:tenants-create-permission"
  description        = "System-admin may create new tenants"

  resources = [keycloak_openid_client_authorization_resource.admin_tenants.id]
  scopes    = ["create"]
  policies  = [keycloak_openid_client_role_policy.system_admin.id]
}

resource "keycloak_openid_client_authorization_permission" "admin_tenants_read" {
  resource_server_id = keycloak_openid_client.bff.resource_server_id
  realm_id           = keycloak_realm.platform.id
  name               = "admin:tenants-read-permission"
  description        = "System-admin may read tenant resource configurations"

  resources = [keycloak_openid_client_authorization_resource.admin_tenants.id]
  scopes    = ["read"]
  policies  = [keycloak_openid_client_role_policy.system_admin.id]
}

# ---------------------------------------------------------------------------
# Composed-service SSO (ADR-0073). OIDC clients + realm-role token mappers so the
# composed Compose GUI services authenticate via the platform Keycloak realm with
# role-mapped authorisation ("properly permitted"). Opt-in via enable_composed_sso
# (default false) so default provisioning is unchanged. Grafana + SonarQube are
# confidential clients (secret); MinIO + pgAdmin already exist above as public PKCE
# clients — they only gain a realm-role mapper here. Live OIDC flows are proven on a
# running stack (ADR-0073 proof requirements).
# ---------------------------------------------------------------------------

resource "keycloak_openid_client" "grafana" {
  count     = var.enable_composed_sso ? 1 : 0
  realm_id  = keycloak_realm.platform.id
  client_id = "grafana"
  name      = "Grafana"
  enabled   = true

  access_type                  = "CONFIDENTIAL"
  standard_flow_enabled        = true
  implicit_flow_enabled        = false
  direct_access_grants_enabled = false

  client_secret = var.grafana_oidc_client_secret

  valid_redirect_uris = [
    "http://localhost:3200/grafana/login/generic_oauth",
    "http://${var.apex_domain}/grafana/login/generic_oauth",
    "https://${var.apex_domain}/grafana/login/generic_oauth",
  ]
  web_origins = ["+"]
}

resource "keycloak_openid_client" "sonarqube" {
  count     = var.enable_composed_sso ? 1 : 0
  realm_id  = keycloak_realm.platform.id
  client_id = "sonarqube"
  name      = "SonarQube"
  enabled   = true

  access_type                  = "CONFIDENTIAL"
  standard_flow_enabled        = true
  implicit_flow_enabled        = false
  direct_access_grants_enabled = false

  client_secret = var.sonar_oidc_client_secret

  valid_redirect_uris = [
    "http://localhost:9064/sonar/oauth2/callback/oidc",
    "http://${var.apex_domain}/sonar/oauth2/callback/oidc",
    "https://${var.apex_domain}/sonar/oauth2/callback/oidc",
  ]
  web_origins = ["+"]
}

# Realm-role token mappers — each composed service receives the user's realm roles
# (claim "roles") in the ID token + userinfo so it can map platform roles to service
# roles. Gated by the same flag so they only exist when SSO is enabled.
resource "keycloak_openid_user_realm_role_protocol_mapper" "grafana_roles" {
  count               = var.enable_composed_sso ? 1 : 0
  realm_id            = keycloak_realm.platform.id
  client_id           = keycloak_openid_client.grafana[0].id
  name                = "realm-roles"
  claim_name          = "roles"
  multivalued         = true
  add_to_id_token     = true
  add_to_access_token = true
  add_to_userinfo     = true
}

resource "keycloak_openid_user_realm_role_protocol_mapper" "sonarqube_roles" {
  count               = var.enable_composed_sso ? 1 : 0
  realm_id            = keycloak_realm.platform.id
  client_id           = keycloak_openid_client.sonarqube[0].id
  name                = "realm-roles"
  claim_name          = "roles"
  multivalued         = true
  add_to_id_token     = true
  add_to_access_token = true
  add_to_userinfo     = true
}

resource "keycloak_openid_user_realm_role_protocol_mapper" "minio_roles" {
  count               = var.enable_composed_sso ? 1 : 0
  realm_id            = keycloak_realm.platform.id
  client_id           = keycloak_openid_client.minio.id
  name                = "realm-roles"
  claim_name          = "roles"
  multivalued         = true
  add_to_id_token     = true
  add_to_access_token = true
  add_to_userinfo     = true
}

resource "keycloak_openid_user_realm_role_protocol_mapper" "pgadmin_roles" {
  count               = var.enable_composed_sso ? 1 : 0
  realm_id            = keycloak_realm.platform.id
  client_id           = keycloak_openid_client.pgadmin.id
  name                = "realm-roles"
  claim_name          = "roles"
  multivalued         = true
  add_to_id_token     = true
  add_to_access_token = true
  add_to_userinfo     = true
}

# MinIO console authorisation — MinIO maps the claim named by
# MINIO_IDENTITY_OPENID_CLAIM_NAME (set to "policy") to a MinIO policy. Without a
# matching policy, an OIDC-authenticated user is DENIED. The platform forward-auth
# gate already restricts the MinIO click-through to operators, so SSO'd users get the
# built-in consoleAdmin policy. Gated by the same flag (ADR-0073).
resource "keycloak_openid_hardcoded_claim_protocol_mapper" "minio_policy" {
  count               = var.enable_composed_sso ? 1 : 0
  realm_id            = keycloak_realm.platform.id
  client_id           = keycloak_openid_client.minio.id
  name                = "minio-policy"
  claim_name          = "policy"
  claim_value         = "consoleAdmin"
  claim_value_type    = "String"
  add_to_id_token     = true
  add_to_access_token = true
  add_to_userinfo     = true
}
