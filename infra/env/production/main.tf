# env/production/main.tf
#
# Provision Keycloak resources for the production environment.
# Targeted at the production Keycloak realm.
#
# Prerequisites:
#   - Copy production.tfvars.example to production.tfvars and fill in values
#   - Remote state backend configured
#   - terraform init (requires backend access)
#
# ADR-0023: Declarative infrastructure provisioning model
# ADR-0033: Environment-specific domain configuration ? production uses aldous.info with Cloudflare TLS
	erraform {
  required_version = "~> 1.13"
  required_providers {
    keycloak = {
      source  = "mrparkers/keycloak"
      version = "~> 4.4"
    }
  }
}

variable "keycloak_url" {
  description = "Keycloak server URL (internal)"
  type        = string
}

variable "keycloak_admin_user" {
  description = "Keycloak admin username"
  type        = string
}

variable "keycloak_admin_password" {
  description = "Keycloak admin password"
  type        = string
}

variable "keycloak_realm" {
  description = "Keycloak realm name"
  type        = string
  default     = "platform"
}

variable "redirect_uris" {
  description = "OAuth redirect URIs for the BFF client"
  type        = list(string)
}

variable "web_origins" {
  description = "Allowed web origins for CORS"
  type        = list(string)
}

variable "kc_hostname" {
  description = "Keycloak frontend hostname URL (determines token issuer). For production: https://aldous.info/kc"
  type        = string
  default     = "https://aldous.info/kc"
}

variable "apex_domain" {
  description = "Apex domain for FQDN-based tenant routing. For production: aldous.info"
  type        = string
  default     = "aldous.info"
}

variable "bff_client_secret" {
  description = "Client secret for the BFF confidential client. Must match platform-api KEYCLOAK_CLIENT_SECRET."
  type        = string
  sensitive   = true
}

variable "provisioner_client_secret" {
  description = "Client secret for the platform-provisioner service account"
  type        = string
  sensitive   = true
}

variable "fixture_user_password" {
  description = "Password for fixture test users (local/dev only)"
  type        = string
  default     = ""
}

variable "provision_fixture_users" {
  description = "Whether to provision fixture test users (local/dev only)"
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

  keycloak_url   = var.keycloak_url
  realm_name = var.keycloak_realm
  kc_hostname    = var.kc_hostname
  apex_domain    = var.apex_domain
  bff_client_secret = var.bff_client_secret
  provisioner_client_secret = var.provisioner_client_secret

  fixture_user_password  = var.fixture_user_password
  provision_fixture_users = var.provision_fixture_users

  # Production-specific BFF redirect URIs (HTTPS via aldous.info)
  spa_redirect_uris = var.redirect_uris
  spa_web_origins   = var.web_origins
  bff_redirect_uris = var.redirect_uris
}
