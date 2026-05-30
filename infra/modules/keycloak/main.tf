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
  service_accounts_enabled     = false

  # PKCE as additional security layer even for confidential clients
  pkce_code_challenge_method = "S256"

  client_secret = var.bff_client_secret

  # BFF callback endpoints ? the BFF exchanges code at the server, not the browser.
  # Generated from kc_hostname and apex_domain for environment-appropriate redirect URIs.
  # Override via bff_redirect_uris variable if custom URIs are needed.
  # Note: "+" would allow all valid redirect URIs; we use explicit list for security.
  valid_redirect_uris = var.bff_redirect_uris
  web_origins         = ["+"]
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
