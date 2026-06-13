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
# SPA client (public, PKCE) ? React app
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
# BFF/API client (confidential) ? platform-api handles the OAuth callback
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
# Fixture users ? local/dev only
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

variable "kc_hostname" {
  type        = string
  description = "Keycloak hostname (KC_HOSTNAME v2) ? determines the token issuer (iss claim). Must match the public-facing URL for the environment. (ADR-0033)"
  default     = "http://localhost/kc"
}

variable "apex_domain" {
  type        = string
  description = "Apex domain for FQDN-based tenant routing. Used to construct redirect URIs and web origins for the environment. (ADR-0029, ADR-0033)"
  default     = "aldous.info"
}

# ---------------------------------------------------------------------------
# Composed-service SSO (ADR-0073) — ON by default for every composed service that
# supports OIDC (Grafana/SonarQube/MinIO/pgAdmin)
# ---------------------------------------------------------------------------

variable "enable_composed_sso" {
  type        = bool
  description = "Create OIDC clients + realm-role mappers for the composed Compose GUI services (Grafana, SonarQube, MinIO, pgAdmin). Default true — SSO is on for every composed service that supports it (ADR-0073)."
  default     = true
}

variable "grafana_oidc_client_secret" {
  type        = string
  sensitive   = true
  description = "Client secret for the Grafana confidential OIDC client. Sourced from the generated env (GRAFANA_OIDC_CLIENT_SECRET), never committed."
  default     = ""
}

variable "sonar_oidc_client_secret" {
  type        = string
  sensitive   = true
  description = "Client secret for the SonarQube confidential OIDC client. Sourced from the generated env (SONAR_OIDC_CLIENT_SECRET), never committed."
  default     = ""
}
