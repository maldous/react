# ---------------------------------------------------------------------------
# env/dev ? Dev Keycloak provisioning (ADR-ACT-0110)
#
# Targets the dev Compose Keycloak service (identity profile).
# Start with: docker compose --profile identity up -d keycloak
#
# Provider config lives in versions.tf.
# Variable values live in dev.tfvars (gitignored); use dev.tfvars.example
# as the template.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Variables ? provider
# ---------------------------------------------------------------------------

variable "keycloak_url" {
  type        = string
  description = "Keycloak base URL. Must match KEYCLOAK_PORT in .env / compose.yaml."
  default     = "http://localhost:8080"
}

variable "keycloak_admin_user" {
  type        = string
  description = "Keycloak admin username. Matches KEYCLOAK_ADMIN_USER in compose.yaml."
  default     = "admin"
}

variable "keycloak_admin_password" {
  type        = string
  sensitive   = true
  description = "Keycloak admin password. Matches KEYCLOAK_ADMIN_PASSWORD in compose.yaml."
}

# ---------------------------------------------------------------------------
# Variables ? module
# ---------------------------------------------------------------------------

variable "realm_name" {
  type    = string
  default = "platform"
}

variable "bff_client_secret" {
  type        = string
  sensitive   = true
  description = "Client secret for platform-api confidential client. Gitignored in dev.tfvars."
}

variable "provisioner_client_secret" {
  type      = string
  sensitive = true
}

# Composed-service SSO (ADR-0073) — ON by default; secrets from the generated env.
variable "enable_composed_sso" {
  type    = bool
  default = true
}

variable "grafana_oidc_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "sonar_oidc_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "keycloak_is_local" {
  description = "Set to true only in dev.tfvars for localhost/Docker-internal Keycloak. Gates provision_fixture_users."
  type        = bool
  default     = false
}

variable "provision_fixture_users" {
  description = "Provision fixture test users. Requires keycloak_is_local=true — never set both true for a remote Keycloak."
  type        = bool
  default     = true
  validation {
    condition     = !var.provision_fixture_users || var.keycloak_is_local
    error_message = "provision_fixture_users=true requires keycloak_is_local=true. Set keycloak_is_local=true only in tfvars files that target a localhost or Docker-internal Keycloak."
  }
}

variable "fixture_user_password" {
  type      = string
  sensitive = true
  default   = ""
}

variable "kc_hostname" {
  type        = string
  description = "Keycloak hostname for the token issuer (iss claim). Default matches local Compose with Caddy."
  default     = "http://localhost/kc"
}

variable "apex_domain" {
  type        = string
  description = "Apex domain for FQDN-based tenant routing (ADR-0029, ADR-0033)."
  default     = "aldous.info"
}

# ---------------------------------------------------------------------------
# Keycloak module
# ---------------------------------------------------------------------------

module "keycloak" {
  source = "../../modules/keycloak"

  keycloak_url       = var.keycloak_url
  realm_name         = var.realm_name
  realm_display_name = "Enterprise Platform (local)"
  kc_hostname        = var.kc_hostname
  apex_domain        = var.apex_domain

  # SPA client ? public PKCE for future direct-SPA flows
  spa_client_id = "platform-spa"
  spa_redirect_uris = [
    "http://localhost:5173/*",
    "http://localhost:5173/auth/callback",
  ]
  spa_web_origins = ["http://localhost:5173"]

  # BFF/API client ? confidential, handles OAuth callback (ADR-0022)
  bff_client_id     = "platform-api"
  bff_client_secret = var.bff_client_secret
  bff_redirect_uris = [
    # Vite dev server (standard local development)
    "http://localhost:5173/auth/callback",
    "http://localhost:5173/*",
    # Caddy web profile ? default PLATFORM_API_URL=http://localhost
    "http://localhost/auth/callback",
    "http://localhost/*",
    # Dev .localhost TLD ? auto-resolving RFC 6761 (ADR-0033)
    "http://dev.localhost/auth/callback",
    "http://dev.localhost/*",
    # Test .localhost TLD ? auto-resolving RFC 6761 (ADR-0033)
    "http://test.localhost/auth/callback",
    "http://test.localhost/*",
    # Caddy web profile ? when PLATFORM_API_URL=http://aldous.info (real-auth E2E)
    # Requires 127.0.0.1 aldous.info in /etc/hosts
    "http://aldous.info/auth/callback",
    "http://aldous.info/*",
    # Cloudflare HTTPS (Flexible SSL ? browser sees HTTPS, origin sees HTTP)
    "https://aldous.info/auth/callback",
    "https://aldous.info/*",
    # Legacy BFF direct (pre-Vite proxy)
    "http://localhost:3001/auth/callback",
    "http://localhost:3001/*",
  ]

  # platform-provisioner service account ? used by platform-api for runtime
  # Keycloak realm creation when tenants are provisioned via POST /api/admin/tenants.
  provisioner_client_secret = var.provisioner_client_secret

  provision_fixture_users = var.provision_fixture_users
  fixture_user_password   = var.fixture_user_password

  # Composed-service SSO (ADR-0073) — opt-in OIDC clients for Grafana/SonarQube/MinIO/pgAdmin.
  enable_composed_sso        = var.enable_composed_sso
  grafana_oidc_client_secret = var.grafana_oidc_client_secret
  sonar_oidc_client_secret   = var.sonar_oidc_client_secret
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------

output "realm_name" {
  value = module.keycloak.realm_name
}

output "spa_client_id" {
  value = module.keycloak.spa_client_id
}

output "bff_client_id" {
  value = module.keycloak.bff_client_id
}
