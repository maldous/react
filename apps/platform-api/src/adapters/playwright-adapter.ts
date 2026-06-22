/**
 * Provider reliability evidence for PlaywrightAdapter.
 *
 * Runtime behavior is provided by the committed Playwright configs, e2e specs,
 * scenario manifests, and evidence ladder commands.
 */
export const playwrightAdapterReliabilityEvidence = {
  configSource:
    "playwright.*.config.ts, scenario manifests, process.env BASE_URL/stage environment, and package scripts configure browser execution",
  secretSource:
    "browser tests use fixture credentials and managed stage secrets through test env; secrets are never written to reports intentionally",
  timeout: "Playwright test and expect timeouts bound browser, navigation, and assertion execution",
  retry:
    "retry is explicit in Playwright configuration or operator reruns after repairing stage/browser state",
  degradedMode:
    "unavailable browser, route, or stage fails the e2e gate instead of marking evidence successful",
  failClosed:
    "failed Playwright specs, missing traces, or invalid scenario manifests exit non-zero and block promotion",
  fallbackRationale:
    "no fallback browser provider is used; Playwright is the committed e2e execution substrate",
  healthCheck:
    "scenario manifest, e2e result contract, confidence ladder, and Playwright specs exercise browser-provider readiness",
  operatorRecovery:
    "operator recovery: repair browser install/stage URL/fixtures/spec failure, inspect trace, then rerun the owning Playwright command",
};
