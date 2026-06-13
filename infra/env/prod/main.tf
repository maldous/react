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

# keycloak_url is the internal Keycloak server URL used by the Terraform provider.
# Must be https:// for any non-loopback deployment; http://localhost is allowed
# for local stack testing where TLS is not available.
variable "keycloak_url" {
  description = "Keycloak server URL (internal, with KC_HTTP_RELATIVE_PATH prefix). https:// required for non-localhost."
  type        = string
  validation {
    condition = (
      startswith(var.keycloak_url, "https://") ||
      startswith(var.keycloak_url, "http://localhost") ||
      startswith(var.keycloak_url, "http://127.")
    )
    error_message = "keycloak_url must use https:// except when targeting localhost/127.x for local stack testing."
  }
}

# No default — force the operator to supply an explicit value so the wrong
# credentials are never silently used against a real Keycloak instance.
variable "keycloak_admin_user" {
  description = "Keycloak admin username. Supply explicitly in tfvars — no default to prevent accidental credential reuse."
  type        = string
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

# Defaults to https:// — safe for real production deployments.
# Local prod-stack testing (aldous.info → 127.0.0.1 via /etc/hosts) must
# explicitly set http:// in prod.tfvars; Cloudflare handles TLS externally.
variable "redirect_uris" {
  description = "OAuth redirect URIs for the BFF client. Use https:// for real production."
  type        = list(string)
  default     = ["https://aldous.info/auth/callback"]
}

variable "web_origins" {
  description = "Allowed web origins for CORS. Use https:// for real production."
  type        = list(string)
  default     = ["https://aldous.info"]
}

# Default is https:// — the correct value for real production where Cloudflare
# provides TLS. Local prod-stack must explicitly set http:// in prod.tfvars
# because the local stack has no TLS certificate.
variable "kc_hostname" {
  description = "Keycloak frontend hostname URL (token issuer). https://aldous.info/kc for real production."
  type        = string
  default     = "https://aldous.info/kc"
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
  description = "Password for fixture test users. Only relevant when provision_fixture_users = true."
  type        = string
  sensitive   = true
  default     = ""
}

# Fixture users (sysadmin, admin, viewer) are backdoor accounts — they must
# never be provisioned against a remote (real) production Keycloak.
# keycloak_is_local=true must be set explicitly in prod.tfvars (local stack only).
# Real production tfvars omit or set it to false; provision_fixture_users=true
# without keycloak_is_local=true is rejected by the validation block below.
variable "keycloak_is_local" {
  description = "Set to true only in prod.tfvars for local prod-stack testing. Must be false for real production."
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
  # realm must be "master" for provider authentication regardless of KEYCLOAK_REALM env var.
  # run-stage.sh sources .env.prod which exports KEYCLOAK_REALM=platform-production; the
  # mrparkers/keycloak provider reads this and tries realms/platform-production for its own
  # auth — which doesn't exist on first boot. Explicit realm = "master" takes precedence.
  realm = "master"
}

module "keycloak" {
  source = "../../modules/keycloak"

  keycloak_url               = var.keycloak_url
  realm_name                 = var.keycloak_realm
  kc_hostname                = var.kc_hostname
  apex_domain                = var.apex_domain
  bff_client_secret          = var.bff_client_secret
  provisioner_client_secret  = var.provisioner_client_secret
  fixture_user_password      = var.fixture_user_password
  enable_composed_sso        = var.enable_composed_sso
  grafana_oidc_client_secret = var.grafana_oidc_client_secret
  sonar_oidc_client_secret   = var.sonar_oidc_client_secret
  pgadmin_oidc_client_secret = var.pgadmin_oidc_client_secret
  provision_fixture_users    = var.provision_fixture_users

  # Production BFF redirect URIs (aldous.info)
  spa_redirect_uris = var.redirect_uris
  spa_web_origins   = var.web_origins
  bff_redirect_uris = var.redirect_uris
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
