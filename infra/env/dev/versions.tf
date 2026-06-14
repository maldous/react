terraform {
  required_version = ">= 1.0"

  required_providers {
    keycloak = {
      source  = "keycloak/keycloak"
      version = "~> 5.0"
    }
  }
}

provider "keycloak" {
  client_id = "admin-cli"
  username  = var.keycloak_admin_user
  password  = var.keycloak_admin_password
  url       = var.keycloak_url
  # realm must be "master" for provider authentication regardless of KEYCLOAK_REALM env var.
  # KEYCLOAK_REALM=platform is set in .env.dev for the application, but the mrparkers/keycloak
  # provider picks it up via env and tries to authenticate against realms/platform — which
  # doesn't exist on first boot. Explicit realm = "master" takes precedence over the env var.
  realm = "master"
}
