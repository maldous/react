terraform {
  required_providers {
    keycloak = {
      # Maintained fork (mrparkers archived). v5.x supports Keycloak 26 incl.
      # Authorization Services, which mrparkers ~4.4 could not (ADR-ACT-0279).
      source  = "keycloak/keycloak"
      version = "~> 5.0"
    }
  }
}
