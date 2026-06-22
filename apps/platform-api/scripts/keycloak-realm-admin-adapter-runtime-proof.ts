/**
 * Provider-level proof wrapper for keycloak-realm-admin-adapter.
 *
 * The delegated proof exercises live Keycloak configuration/readiness,
 * unavailable provider classification, forbidden realm operations,
 * credential mutation, and fail-closed misconfiguration paths.
 */
await import("./auth-settings-runtime-proof.ts");
