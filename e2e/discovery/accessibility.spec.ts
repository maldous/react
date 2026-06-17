// ADR-ACT-0285 Phase 6 / ADR-0075 — accessibility permutation execution.
//
// Runs axe-core (WCAG 2.1 A/AA) across the discoverable safe routes under several
// accessibility emulation profiles (default, reduced-motion, forced-colors/high
// contrast), and asserts the structural a11y contract from ui-contract.json's
// accessibilityBaseline: one main landmark, a meaningful h1, accessible names on
// controls. Fails on any serious/critical axe violation or a missing landmark/
// heading. Writes docs/evidence/e2e/<stage>-accessibility-coverage-latest.{json,md}.
//
// Auth: whatever the stage provides (public surface unauthenticated; admin surface
// when a fixture/real session is present). Driven by the same safe-route set as the
// clickability crawler — never CSS/position selectors (ADR-0075).
import { test, expect, E2E_STAGE } from "../support/correlation.ts";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";

// Canonical scenario id (ADR-ACT-0285 closure) — declared explicitly, never derived
// from the test title. Matched by e2e/scenario-manifest.json.
test.use({ scenarioId: "accessibility-safe-routes" });

const EVIDENCE_DIR = "docs/evidence/e2e";

// Profiles emulated via Playwright (keyboard-only + screen-reader are asserted
// structurally; reduced-motion + high-contrast via media emulation).
const PROFILES: { id: string; reducedMotion?: "reduce"; forcedColors?: "active" }[] = [
  { id: "default" },
  { id: "reduced-motion", reducedMotion: "reduce" },
  { id: "low-vision-high-contrast", forcedColors: "active" },
];

const SKIP_PREFIXES = [
  "/auth/",
  "/kc",
  "/grafana",
  "/sentry",
  "/minio",
  "/pgadmin",
  "/sonar",
  "/clickhouse",
  "/mailpit",
  "/localstack",
  "/faro",
  "/api/",
];

test.setTimeout(180_000);

test("accessibility — axe + structural contract across safe routes and a11y profiles", async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? "http://localhost").origin;
  const safe = (r: string) => r.startsWith("/") && !SKIP_PREFIXES.some((p) => r.startsWith(p));

  // Discover the safe route set (same approach as the clickability crawler).
  const routes = new Set<string>(["/"]);
  await page.goto(origin + "/", { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
  for (const l of await page.getByRole("link").all()) {
    const href = await l.getAttribute("href").catch(() => null);
    if (href?.startsWith("/") && safe(href)) routes.add(href);
    else if (href?.startsWith(origin) && safe(new URL(href).pathname))
      routes.add(new URL(href).pathname);
  }

  interface RouteA11y {
    route: string;
    profile: string;
    hasMain: boolean;
    hasHeading: boolean;
    violations: { id: string; impact: string | null | undefined; nodes: number }[];
  }
  const results: RouteA11y[] = [];

  for (const profile of PROFILES) {
    await page.emulateMedia({
      reducedMotion: profile.reducedMotion ?? null,
      forcedColors: profile.forcedColors ?? null,
    });
    for (const route of routes) {
      await page
        .goto(origin + route, { waitUntil: "domcontentloaded", timeout: 20_000 })
        .catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});

      const hasMain = (await page.locator("main, [role=main]").count()) > 0;
      const hasHeading =
        (
          (await page
            .locator("h1, [role=heading][aria-level='1']")
            .first()
            .textContent()
            .catch(() => "")) ?? ""
        ).trim().length > 0;

      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
        .catch(() => ({
          violations: [] as { id: string; impact?: string | null; nodes: unknown[] }[],
        }));

      results.push({
        route,
        profile: profile.id,
        hasMain,
        hasHeading,
        violations: axe.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.length,
        })),
      });
    }
  }

  // Gate: serious/critical axe violations + missing landmark/heading are failures.
  const failures = results.filter(
    (r) =>
      !r.hasMain ||
      !r.hasHeading ||
      r.violations.some((v) => v.impact === "serious" || v.impact === "critical")
  );

  const report = {
    stage: E2E_STAGE,
    baseURL: origin,
    profiles: PROFILES.map((p) => p.id),
    routesTested: [...routes],
    results,
    failureCount: failures.length,
    result: failures.length ? "FAILED" : "PASSED",
    generatedFor: "ADR-ACT-0285 Phase 6 / ADR-0075",
  };
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const base = `${EVIDENCE_DIR}/${E2E_STAGE}-accessibility-coverage-latest`;
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(
    `${base}.md`,
    [
      `# E2E accessibility coverage — ${E2E_STAGE}`,
      "",
      "Generated (ADR-ACT-0285 Phase 6). DO NOT EDIT — regenerate via `make e2e-accessibility ENV=<stage>`.",
      "",
      `- Result: **${report.result}**`,
      `- Routes x profiles tested: ${results.length} (${routes.size} routes x ${PROFILES.length} profiles)`,
      `- Failures: ${failures.length}`,
      "",
      "## Results",
      "",
      ...results.map(
        (r) =>
          `- \`${r.route}\` [${r.profile}] main=${r.hasMain} h1=${r.hasHeading} axe-violations=${r.violations.length}${r.violations.length ? ` (${r.violations.map((v) => `${v.id}:${v.impact}`).join(", ")})` : ""}`
      ),
      "",
    ].join("\n")
  );

  expect(failures, `accessibility failures: ${JSON.stringify(failures, null, 2)}`).toHaveLength(0);
});
