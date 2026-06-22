/**
 * Provider reliability evidence for PlaywrightAxeAdapter.
 *
 * Runtime behavior is provided by Playwright accessibility specs and axe-backed
 * UI/reference harness checks.
 */
export const playwrightAxeAdapterReliabilityEvidence = {
  configSource:
    "Playwright accessibility configs, axe rules, scenario manifests, and process.env stage BASE_URL configure accessibility execution",
  secretSource:
    "no production secret, credential, token, or apiKey is required for accessibility scans",
  timeout: "Playwright and axe scan execution are bounded by browser/test timeouts",
  retry:
    "operator retry is explicit after fixing the page, selector, browser install, or accessibility violation",
  degradedMode:
    "missing pages, browser failures, or axe violations fail the accessibility gate rather than silently passing",
  failClosed:
    "accessibility proof commands exit non-zero on violations or missing required scan evidence",
  fallbackRationale:
    "no fallback accessibility provider is used; Playwright + axe is the committed V1 accessibility substrate",
  healthCheck:
    "accessibility e2e specs and UI reference harness checks exercise scan readiness and violation reporting",
  operatorRecovery:
    "operator recovery: inspect accessibility report/trace, fix violation or selector, then rerun the accessibility command",
};
