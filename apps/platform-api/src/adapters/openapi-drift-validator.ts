/**
 * Provider reliability evidence for validate-openapi-drift.
 *
 * Runtime behavior is provided by tools/architecture/validate-openapi-drift and
 * package script openapi:drift.
 */
export const openApiDriftValidatorReliabilityEvidence = {
  configSource:
    "docs/api/openapi.json, platform route metadata, package scripts, and process.env stage context configure drift validation",
  secretSource: "no secret, credential, token, or apiKey is required for OpenAPI drift validation",
  timeout: "architecture/test command execution bounds drift validation runtime",
  retry:
    "operator retry is explicit after repairing OpenAPI spec, route metadata, or validator input",
  degradedMode:
    "missing route/spec alignment is reported as drift and fails the gate rather than degrading to success",
  failClosed:
    "openapi:drift and architecture tests exit non-zero when live route/spec alignment is broken",
  fallbackRationale:
    "no fallback OpenAPI validator is used; validate-openapi-drift is the committed hard gate",
  healthCheck:
    "validate-openapi-drift unit/integration tests and package command exercise validator readiness",
  operatorRecovery:
    "operator recovery: update route metadata or docs/api/openapi.json, rerun openapi:drift and architecture tests",
};
