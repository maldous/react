/**
 * Provider reliability evidence for static assurance/governance proof surfaces.
 *
 * This provider represents repository-local assurance commands and evidence
 * stores used for USF scope, build-versus-compose decisions, compliance packs,
 * and environment/shared-service policy. It is intentionally not an external
 * service provider.
 */
export const staticAssuranceProviderReliabilityEvidence = {
  configSource:
    "repository-local docs, tools, package scripts, and process.env stage inputs configure static assurance execution",
  secretSource:
    "no secret, credential, token, or apiKey is required; evidence commands must not emit managed secrets",
  timeout:
    "assurance commands run under make/npm stage timeouts and fail the stage on hung or failed execution",
  retry:
    "operator retry is explicit after repairing the failed evidence source, command, or governed document",
  degradedMode:
    "missing evidence, malformed policy, or failing verifier leaves the capability unassured rather than degraded to success",
  failClosed:
    "readiness, architecture, evidence, and stage gates exit non-zero on missing or inconsistent assurance inputs",
  fallbackRationale:
    "no fallback assurance provider is used; committed V1 evidence and verifier output are the semantic source",
  healthCheck:
    "v2-readiness, stage evidence, architecture validators, and release-confidence tests exercise the assurance provider",
  operatorRecovery:
    "operator recovery: repair the failing evidence file or verifier input, rerun the owning command, then rerun readiness and adversarial audit",
};
