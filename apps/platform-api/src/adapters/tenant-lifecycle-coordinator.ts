/**
 * Provider reliability evidence for the tenant lifecycle coordinator.
 *
 * Runtime coordination is implemented by platform-api tenant lifecycle usecases
 * and routes, combining data export, storage, identity realm, DSR, audit, and
 * subsystem compensation behavior.
 */
export const tenantLifecycleCoordinatorReliabilityEvidence = {
  configSource:
    "process.env-backed platform database, storage, Keycloak, and DSR/provider configuration is supplied to tenant lifecycle dependencies before route execution",
  secretSource:
    "database, storage, and Keycloak credential refs are consumed by subsystem adapters; lifecycle responses never expose secret, token, credential, or apiKey material",
  timeout:
    "tenant lifecycle proofs and subsystem calls run under bounded command/route execution with explicit failure propagation",
  retry:
    "operator retry follows the failed subsystem step after audit/export state is inspected; lifecycle code does not hide partial failure",
  degradedMode:
    "suspend/delete/export operations stop on subsystem failures and report failed coordination instead of marking lifecycle complete",
  failClosed:
    "delete requires export first and blocks subsequent destructive coordination when data, storage, realm, DSR, or audit steps fail",
  fallbackRationale:
    "no fallback lifecycle coordinator is used; V1 tenant lifecycle semantics are the source for provision/suspend/delete/export coordination",
  healthCheck:
    "tenant-lifecycle unit and runtime proofs exercise ordered subsystem coordination, failure stop, export-before-delete, and audit behavior",
  operatorRecovery:
    "operator recovery: inspect lifecycle audit/export evidence, repair the failed subsystem, rerun tenant lifecycle proof, and retry the specific operation",
};
