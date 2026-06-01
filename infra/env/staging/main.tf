# env/staging/main.tf
#
# Provision Keycloak resources for the staging environment.
# Targeted at a separate Keycloak realm for staging.
#
# Prerequisites:
#   - Copy staging.tfvars.example to staging.tfvars and fill in values
#   - terraform init -upgrade -backend=false (for validation)
#
# ADR-0023: Declarative infrastructure provisioning model
# ADR-0033: Environment-specific domain configuration ? staging uses staging.aldous.info

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
  default     = "platform-staging"
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
  description = "Keycloak frontend hostname URL (determines token issuer). For staging: https://staging.aldous.info/kc"
  type        = string
  default     = "https://staging.aldous.info/kc"
}

variable "apex_domain" {
  description = "Apex domain for FQDN-based tenant routing. For staging: staging.aldous.info"
  type        = string
  default     = "staging.aldous.info"
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
  description = "Password for fixture test users (staging should NOT provision fixture users by default)"
  type        = string
  default     = ""
}

variable "keycloak_is_local" {
  description = "Set to true only in staging.tfvars for localhost/Docker-internal Keycloak. Gates provision_fixture_users."
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

  # Staging-specific BFF redirect URIs (HTTPS via staging.aldous.info)
  spa_redirect_uris = var.redirect_uris
  spa_web_origins   = var.web_origins
  bff_redirect_uris = var.redirect_uris
}
