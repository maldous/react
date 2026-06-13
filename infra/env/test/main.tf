# ---------------------------------------------------------------------------
# env/test ? Keycloak provisioning for the test/CI environment
#
# ADR-0033: Test environment uses the .localhost TLD convention.
#   APEX_DOMAIN = test.localhost  (auto-resolves to 127.0.0.1 ? RFC 6761)
#   KC_HOSTNAME = http://test.localhost/kc
# Override for real test DNS environments.
# ---------------------------------------------------------------------------

variable "keycloak_url" {
  type        = string
  description = "Keycloak base URL (e.g. http://keycloak:8080 for Docker-internal)"
  default     = "http://keycloak:8080/kc"
}

variable "keycloak_admin_user" {
  type        = string
  description = "Keycloak admin username"
  default     = "admin"
}

variable "keycloak_admin_password" {
  type        = string
  sensitive   = true
  description = "Keycloak admin password"
}

variable "realm_name" {
  type    = string
  default = "platform-test"
}

variable "bff_client_secret" {
  type        = string
  sensitive   = true
  description = "Client secret for platform-api confidential client"
}

variable "provisioner_client_secret" {
  type      = string
  sensitive = true
}

variable "keycloak_is_local" {
  description = "Set to true only in test.tfvars for localhost/Docker-internal Keycloak. Gates provision_fixture_users."
  type        = bool
  default     = false
}

variable "provision_fixture_users" {
  description = "Provision fixture test users. Requires keycloak_is_local=true — never set both true for a remote Keycloak."
  type        = bool
  default     = false
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
  description = "Keycloak hostname for the token issuer (iss claim). ADR-0033."
  default     = "http://test.localhost/kc"
}

variable "apex_domain" {
  type        = string
  description = "Apex domain for FQDN-based tenant routing. ADR-0029, ADR-0033."
  default     = "test.localhost"
}

# ---------------------------------------------------------------------------
# Keycloak module
# ---------------------------------------------------------------------------

module "keycloak" {
  source = "../../modules/keycloak"

  keycloak_url       = var.keycloak_url
  realm_name         = var.realm_name
  realm_display_name = "Enterprise Platform (test)"
  kc_hostname        = var.kc_hostname
  apex_domain        = var.apex_domain

  spa_client_id = "platform-spa"
  spa_redirect_uris = [
    "http://localhost:5173/*",
    "http://localhost:5173/auth/callback",
  ]
  spa_web_origins = ["http://localhost:5173"]

  bff_client_id     = "platform-api"
  bff_client_secret = var.bff_client_secret
  bff_redirect_uris = [
    "http://localhost/auth/callback",
    "http://localhost/*",
    "http://localhost:3001/auth/callback",
    "http://localhost:3001/*",
  ]

  provisioner_client_secret = var.provisioner_client_secret

  provision_fixture_users    = var.provision_fixture_users
  fixture_user_password      = var.fixture_user_password
  enable_composed_sso        = var.enable_composed_sso
  grafana_oidc_client_secret = var.grafana_oidc_client_secret
  sonar_oidc_client_secret   = var.sonar_oidc_client_secret
  pgadmin_oidc_client_secret = var.pgadmin_oidc_client_secret
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
variable "pgadmin_oidc_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}
