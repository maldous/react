// ADR-ACT-0285 Phase 4 / ADR-0075 — dynamic clickability crawler (discovery layer).
//
// Starts at /, discovers visible clickable surfaces via ACCESSIBLE ROLES (never CSS
// classes / DOM position — ADR-0075), safely follows same-origin SPA navigations,
// and on every visited page asserts the quality gates: a main landmark, a page
// heading, no console errors, no pageerror, no failed JS/CSS/image/font asset, no
// blank page. It also diffs discovered routes against e2e/ui-contract.json to flag
// orphaned / new / untested surfaces (workstream 12 discovery layer).
//
// SAFE BY DEFAULT: the crawler only performs GET navigations to same-origin SPA
// routes. It never submits forms, never clicks destructive controls, and never
// follows tool-clickthrough/logout/auth routes (they leave the SPA). Destructive
// coverage is contract-driven and stage-gated elsewhere.
//
// Auth: uses whatever session the stage provides (fixture cookie in dev/test via
// the running server, or unauthenticated public surface). Real-auth multi-persona
// crawling is ADR-ACT-0285 Phase 6.
import { test, expect, TEST_RUN_ID, E2E_STAGE } from "../support/correlation.ts";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

// Canonical scenario id (ADR-ACT-0285 closure) — declared explicitly, never derived
// from the test title. Matched by e2e/scenario-manifest.json.
test.use({ scenarioId: "clickability-crawl" });

const EVIDENCE_DIR = "docs/evidence/e2e";
const MAX_PAGES = Number(process.env["CRAWL_MAX_PAGES"] ?? 40);

// Routes that leave the SPA (tool clickthroughs / auth) — never crawled.
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

interface Visited {
  route: string;
  status: "ok" | "violation";
  violations: string[];
  hasMain: boolean;
  hasHeading: boolean;
  clickableCount: number;
}

test.setTimeout(180_000);

test("clickability crawl — discover + quality-gate every safe surface", async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? "http://localhost").origin;
  const consoleErrors: string[] = [];
  const benignConsole: string[] = [];
  const pageErrors: string[] = [];
  const failedAssets: string[] = [];

  // Expected/benign console noise that is NOT a product defect (so it must not
  // fail the crawl): the unauthenticated /api/session probe returns 401 by design,
  // and Faro telemetry delivery is best-effort (faro.ts swallows failures). These
  // are recorded for visibility but excluded from the quality gate.
  const BENIGN_CONSOLE = [
    /status of 401/i,
    /\/api\/session/i,
    /@grafana\/faro/i,
    /\bFaro\b/,
    /\/faro\/collect/i,
  ];
  const isBenign = (text: string) => BENIGN_CONSOLE.some((re) => re.test(text));

  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // A browser "Failed to load resource" console error carries the failing URL
    // in m.location().url, NOT in m.text() — so match benign patterns against
    // both, otherwise best-effort endpoints like /faro/collect leak through.
    const haystack = `${m.text()} ${m.location()?.url ?? ""}`;
    const line = `${page.url()} :: ${m.text()}`;
    if (isBenign(haystack)) benignConsole.push(line);
    else consoleErrors.push(line);
  });
  page.on("pageerror", (e) => pageErrors.push(`${page.url()} :: ${e.message}`));
  page.on("requestfailed", (r) => {
    const t = r.resourceType();
    if (["script", "stylesheet", "image", "font"].includes(t))
      failedAssets.push(`${t} ${r.url()} :: ${r.failure()?.errorText ?? "failed"}`);
  });
  page.on("response", (r) => {
    const t = r.request().resourceType();
    if (["script", "stylesheet", "image", "font"].includes(t) && r.status() >= 400)
      failedAssets.push(`${t} ${r.url()} :: HTTP ${r.status()}`);
  });

  const queue = ["/"];
  const seen = new Set<string>();
  const visited: Visited[] = [];

  const safe = (route: string) =>
    route.startsWith("/") && !SKIP_PREFIXES.some((p) => route.startsWith(p));

  while (queue.length && visited.length < MAX_PAGES) {
    const route = queue.shift()!;
    if (seen.has(route)) continue;
    seen.add(route);
    if (!safe(route)) continue;

    const before = consoleErrors.length + pageErrors.length + failedAssets.length;
    await page
      .goto(new URL(route, origin).toString(), { waitUntil: "domcontentloaded", timeout: 20_000 })
      .catch(() => {});
    // Best-effort settle — the SPA polls Faro continuously so networkidle never
    // fires; cap the wait so the crawl stays fast.
    await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});

    const violations: string[] = [];
    // Quality gates (ADR-ACT-0285 Phase 4).
    const hasMain = (await page.locator("main, [role=main]").count()) > 0;
    const headingText =
      (await page
        .locator("h1, [role=heading][aria-level='1']")
        .first()
        .textContent()
        .catch(() => null)) ?? "";
    const hasHeading = headingText.trim().length > 0;
    const bodyText =
      (await page
        .locator("body")
        .textContent()
        .catch(() => "")) ?? "";
    const blank = bodyText.trim().length < 2;

    if (!hasMain) violations.push("missing main landmark");
    if (!hasHeading) violations.push("missing page heading (h1)");
    if (blank) violations.push("blank page");
    const newErrors = consoleErrors.length + pageErrors.length + failedAssets.length - before;
    if (newErrors > 0) violations.push(`${newErrors} console/page/asset error(s) on load`);

    // Discover clickable surfaces by accessible role (not CSS).
    const links = await page.getByRole("link").all();
    const buttons = await page.getByRole("button").all();
    const clickableCount = links.length + buttons.length;

    visited.push({
      route,
      status: violations.length ? "violation" : "ok",
      violations,
      hasMain,
      hasHeading,
      clickableCount,
    });

    // Enqueue same-origin SPA links for further crawling.
    for (const l of links) {
      const href = await l.getAttribute("href").catch(() => null);
      if (!href) continue;
      let path: string | null = null;
      if (href.startsWith("/")) path = href;
      else if (href.startsWith(origin)) path = new URL(href).pathname;
      if (path && safe(path) && !seen.has(path)) queue.push(path);
    }
  }

  // --- Contract diff (workstream 12) ---
  const contractRoutes: string[] = existsSync("e2e/ui-contract.json")
    ? (JSON.parse(readFileSync("e2e/ui-contract.json", "utf8")).surfaces ?? []).map(
        (s: { route: string }) => s.route
      )
    : [];
  const visitedRoutes = visited.map((v) => v.route);
  const newSurfaces = visitedRoutes.filter((r) => !contractRoutes.includes(r));
  const unreachedContract = contractRoutes.filter((r) => safe(r) && !visitedRoutes.includes(r));

  const violations = visited.filter((v) => v.status === "violation");
  const report = {
    stage: E2E_STAGE,
    testRunId: TEST_RUN_ID,
    baseURL: origin,
    pagesCrawled: visited.length,
    visited,
    discovery: {
      newSurfacesNotInContract: newSurfaces,
      contractRoutesNotReached: unreachedContract,
    },
    consoleErrors,
    benignConsoleIgnored: benignConsole,
    pageErrors,
    failedAssets,
    result: violations.length ? "FAILED" : "PASSED",
    generatedFor: "ADR-ACT-0285 Phase 4 / ADR-0075",
  };

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const base = `${EVIDENCE_DIR}/${E2E_STAGE}-clickability-latest`;
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(
    `${base}.md`,
    [
      `# E2E clickability crawl — ${E2E_STAGE}`,
      "",
      "Generated (ADR-ACT-0285 Phase 4). DO NOT EDIT — regenerate via `make e2e-clickability ENV=<stage>`.",
      "",
      `- Result: **${report.result}**`,
      `- Pages crawled: ${report.pagesCrawled}`,
      `- Violations: ${violations.length}`,
      `- New surfaces not in ui-contract: ${newSurfaces.length}`,
      `- Contract routes not reached this crawl: ${unreachedContract.length}`,
      "",
      "## Pages",
      "",
      ...visited.map(
        (v) =>
          `- \`${v.route}\` — ${v.status}${v.violations.length ? ` (${v.violations.join("; ")})` : ""} [${v.clickableCount} clickable]`
      ),
      "",
    ].join("\n")
  );

  // Fail the run on any quality-gate violation (workstream 4 failure modes).
  expect(
    violations,
    `clickability violations: ${JSON.stringify(violations, null, 2)}`
  ).toHaveLength(0);
});
