# ---------------------------------------------------------------------------
# env/development ? Keycloak provisioning for the development environment
#
# ADR-0033: Development uses the .localhost TLD convention by default.
#   APEX_DOMAIN = dev.localhost  (auto-resolves to 127.0.0.1 ? RFC 6761)
#   KC_HOSTNAME = http://dev.localhost/kc
#
# Override via development.tfvars for CI or shared development hosts.
# Provider config lives in versions.tf (shared with infra/env/local).
# ---------------------------------------------------------------------------

variable "keycloak_url" {
  type        = string
  description = "Keycloak base URL (e.g. http://keycloak:8080 for Docker-internal)"
  default     = "http://localhost:8090/kc"
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
  default = "platform-development"
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

variable "provision_fixture_users" {
  type    = bool
  default = true
}

variable "fixture_user_password" {
  type      = string
  sensitive = true
  default   = ""
}

variable "kc_hostname" {
  type        = string
  description = "Keycloak hostname for the token issuer (iss claim). ADR-0033."
  default     = "http://dev.localhost/kc"
}

variable "apex_domain" {
  type        = string
  description = "Apex domain for FQDN-based tenant routing. ADR-0029, ADR-0033."
  default     = "dev.localhost"
}

# ---------------------------------------------------------------------------
# Keycloak module
# ---------------------------------------------------------------------------

module "keycloak" {
  source = "../../modules/keycloak"

  keycloak_url       = var.keycloak_url
  realm_name         = var.realm_name
  realm_display_name = "Enterprise Platform (development)"
  kc_hostname        = var.kc_hostname
  apex_domain        = var.apex_domain

  spa_client_id = "platform-spa"
  spa_redirect_uris = [
    "http://dev.localhost:5173/*",
    "http://dev.localhost:5173/auth/callback",
  ]
  spa_web_origins = ["http://dev.localhost:5173"]

  bff_client_id     = "platform-api"
  bff_client_secret = var.bff_client_secret
  bff_redirect_uris = [
    "http://dev.localhost/auth/callback",
    "http://dev.localhost/*",
    "http://localhost/auth/callback",
    "http://localhost/*",
  ]

  provisioner_client_secret = var.provisioner_client_secret

  provision_fixture_users = var.provision_fixture_users
  fixture_user_password   = var.fixture_user_password
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
