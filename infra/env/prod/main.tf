# env/prod/main.tf
#
# Provision Keycloak resources for the production environment.
# Targeted at a separate Keycloak realm for production (aldous.info).
#
# Prerequisites:
#   - Copy prod.tfvars.example to prod.tfvars and fill in values
#   - make compose-up-identity ENV=prod
#   - make keycloak-provision ENV=prod
#
# ADR-0023: Declarative infrastructure provisioning model
# ADR-0033: Environment-specific domain configuration — production uses aldous.info

terraform {
  required_version = "~> 1.13"
  required_providers {
    keycloak = {
      source  = "mrparkers/keycloak"
      version = "~> 4.4"
    }
  }
}

variable "keycloak_url" {
  description = "Keycloak server URL (internal, with KC_HTTP_RELATIVE_PATH prefix)"
  type        = string
  default     = "http://localhost:8093/kc"
}

variable "keycloak_admin_user" {
  description = "Keycloak admin username"
  type        = string
  default     = "admin"
}

variable "keycloak_admin_password" {
  description = "Keycloak admin password"
  type        = string
  sensitive   = true
}

variable "keycloak_realm" {
  description = "Keycloak realm name"
  type        = string
  default     = "platform-production"
}

variable "redirect_uris" {
  description = "OAuth redirect URIs for the BFF client"
  type        = list(string)
  default     = ["http://aldous.info/auth/callback"]
}

variable "web_origins" {
  description = "Allowed web origins for CORS"
  type        = list(string)
  default     = ["http://aldous.info"]
}

variable "kc_hostname" {
  description = "Keycloak frontend hostname URL (determines token issuer). Production: http://aldous.info/kc"
  type        = string
  default     = "http://aldous.info/kc"
}

variable "apex_domain" {
  description = "Apex domain for FQDN-based tenant routing. Production: aldous.info"
  type        = string
  default     = "aldous.info"
}

variable "bff_client_secret" {
  description = "Client secret for the BFF confidential client. Must match KEYCLOAK_CLIENT_SECRET in .env.prod."
  type        = string
  sensitive   = true
}

variable "provisioner_client_secret" {
  description = "Client secret for the platform-provisioner service account"
  type        = string
  sensitive   = true
}

variable "fixture_user_password" {
  description = "Password for fixture test users. Required when provision_fixture_users = true."
  type        = string
  sensitive   = true
  default     = ""
}

variable "provision_fixture_users" {
  description = "Whether to provision fixture test users. Set true for local prod-stack E2E; false for real production."
  type        = bool
  default     = false
}

provider "keycloak" {
  client_id = "admin-cli"
  username  = var.keycloak_admin_user
  password  = var.keycloak_admin_password
  url       = var.keycloak_url
}

module "keycloak" {
  source = "../../modules/keycloak"

  keycloak_url              = var.keycloak_url
  realm_name                = var.keycloak_realm
  kc_hostname               = var.kc_hostname
  apex_domain               = var.apex_domain
  bff_client_secret         = var.bff_client_secret
  provisioner_client_secret = var.provisioner_client_secret
  fixture_user_password     = var.fixture_user_password
  provision_fixture_users   = var.provision_fixture_users

  # Production BFF redirect URIs (aldous.info)
  spa_redirect_uris = var.redirect_uris
  spa_web_origins   = var.web_origins
  bff_redirect_uris = var.redirect_uris
}
