# staging.tfvars.example — placeholder values only
# Copy to staging.tfvars and fill in real values (gitignored).
# Do not commit real secrets.
#
# ADR-0033: APEX_DOMAIN = staging.aldous.info
#   KC_HOSTNAME = https://staging.aldous.info/kc

keycloak_url    = "http://localhost:8092/kc"
keycloak_realm  = "platform-staging"
keycloak_client = "platform-spa-staging"

# Environment-specific redirect URIs
redirect_uris = ["http://localhost:5173/*", "https://staging.aldous.info/auth/callback"]
web_origins   = ["http://localhost:5173", "https://staging.aldous.info"]

# Keycloak frontend hostname (determines token issuer)
# Locally: http; Cloudflare: https
kc_hostname = "https://staging.aldous.info/kc"

# Apex domain for FQDN-based tenant routing
# Staging: *.staging.aldous.info resolves to the staging Caddy
apex_domain = "staging.aldous.info"

# Enable fixture users for local testing — required for E2E auth tests
keycloak_is_local       = true
provision_fixture_users = true

bff_client_secret         = "local-dev-bff-secret"
provisioner_client_secret = "local-dev-provisioner-secret"

keycloak_admin_user     = "admin"
keycloak_admin_password = "admin"

# Fixture user password for E2E auth tests
fixture_user_password = "password"
