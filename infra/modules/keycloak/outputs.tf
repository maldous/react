output "realm_id" {
  value       = keycloak_realm.platform.id
  description = "The Keycloak realm ID"
}

output "realm_name" {
  value       = keycloak_realm.platform.realm
  description = "The Keycloak realm name"
}

output "spa_client_id" {
  value       = keycloak_openid_client.spa.client_id
  description = "Client ID of the SPA public client"
}

output "bff_client_id" {
  value       = keycloak_openid_client.bff.client_id
  description = "Client ID of the BFF/API confidential client"
}

output "platform_claims_scope_name" {
  value       = keycloak_openid_client_scope.platform_claims.name
  description = "Name of the platform-claims optional scope"
}
