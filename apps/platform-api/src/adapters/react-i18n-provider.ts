/**
 * Provider reliability evidence for the React/i18n runtime provider.
 *
 * Runtime implementation lives in @platform/i18n-runtime and is exercised by the
 * package unit tests plus application i18n validation gates.
 */
export const reactI18nProviderReliabilityEvidence = {
  configSource:
    "locale configuration and translation catalog paths are loaded from package runtime configuration and build/test process.env context",
  secretSource:
    "no secret, credential, token, or apiKey is required for locale lookup or React i18n rendering",
  timeout:
    "i18n lookups are in-process and bounded by request/render execution; validation tests fail on missing or malformed catalogs",
  retry:
    "operator retry is to repair locale assets and rerun i18n validation; runtime does not retry missing keys into silent defaults",
  degradedMode:
    "missing translation/catalog state is reported by validation failure instead of pretending the provider is ready",
  failClosed: "invalid locale catalogs fail the i18n validation gate and block promotion",
  fallbackRationale:
    "fallback locale behavior is explicit in i18n-runtime; no external translation provider fallback is attempted",
  healthCheck:
    "packages/i18n-runtime tests and architecture i18n validation prove catalog load and React binding behavior",
  operatorRecovery:
    "operator recovery: repair locale JSON/catalog keys, rerun validate-i18n and i18n-runtime tests, then retry promotion",
};

export { createI18n, createReactI18n } from "@platform/i18n-runtime";
