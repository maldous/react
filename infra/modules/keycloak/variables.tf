variable "keycloak_url" {
  type        = string
  description = "Keycloak base URL (e.g. http://localhost:8080)"
}

variable "realm_name" {
  type        = string
  description = "Keycloak realm name"
  default     = "platform"
}

variable "realm_display_name" {
  type        = string
  description = "Human-readable realm display name shown on the Keycloak login page"
  default     = "Enterprise Platform"
}

# ---------------------------------------------------------------------------
# SPA client (public, PKCE) — React app
# ---------------------------------------------------------------------------

variable "spa_client_id" {
  type        = string
  description = "Client ID for the React SPA (public, PKCE). Provisioned for future direct-SPA flows; current ADR-ACT-0008 slice uses fixture sessions."
  default     = "platform-spa"
}

variable "spa_redirect_uris" {
  type        = list(string)
  description = "Allowed OAuth redirect URIs for the SPA client"
}

variable "spa_web_origins" {
  type        = list(string)
  description = "Allowed CORS web origins for the SPA client"
}

# ---------------------------------------------------------------------------
# BFF/API client (confidential) — platform-api handles the OAuth callback
# ---------------------------------------------------------------------------

variable "bff_client_id" {
  type        = string
  description = "Client ID for the BFF/API confidential client (ADR-0022)"
  default     = "platform-api"
}

variable "bff_client_secret" {
  type        = string
  sensitive   = true
  description = "Client secret for the BFF/API confidential client. Store in .tfvars (gitignored), not in code."
}

variable "bff_redirect_uris" {
  type        = list(string)
  description = "Allowed OAuth redirect URIs for the BFF/API client (callback endpoints)"
}

# ---------------------------------------------------------------------------
# Fixture users — local/dev only
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# platform-provisioner service account
# ---------------------------------------------------------------------------

variable "provisioner_client_id" {
  type        = string
  description = "Client ID for the platform-provisioner service account (ADR-0031)"
  default     = "platform-provisioner"
}

variable "provisioner_client_secret" {
  type        = string
  sensitive   = true
  description = "Client secret for the platform-provisioner service account. Store in .tfvars."
}

variable "provision_fixture_users" {
  type        = bool
  description = "Create fixture test users matching seed.ts. Set true for local/development only; never for staging or production."
  default     = false
}

variable "fixture_user_password" {
  type        = string
  sensitive   = true
  description = "Password for all fixture test users. Only used when provision_fixture_users = true. Local/dev only."
  default     = ""
}
