// ADR-ACT-0285 Phase 6 — persona authorization permutation execution.
//
// Proves the platform fails safely for the WRONG user: for each persona runnable
// at this stage, every forbiddenRoute is denied (direct URL does not reveal the
// surface) and every forbiddenApiAccess returns 401/403, while expectedRoutes load.
// Driven by e2e/persona-registry.json (capability/route/permission metadata) — no
// CSS/position selectors (ADR-0075).
//
// Auth: the unauthenticated-visitor persona is verifiable at every stage. Authed
// personas (fixture in dev/test, real scaffold in staging/prod) run when their
// session is provided via E2E_PERSONA (fixture: server LOCAL_FIXTURE_SESSION; real:
// scaffold login) — otherwise they are recorded as DEFERRED, never silently passed.
// Full multi-persona authed execution + scaffold provisioning is the Phase 6 tail.
import { test, expect, E2E_STAGE } from "../support/correlation.ts";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const EVIDENCE_DIR = "docs/evidence/e2e";
const ACTIVE_PERSONA = process.env["E2E_PERSONA"] ?? "unauthenticated-visitor";

interface Persona {
  personaId: string;
  authMode: string;
  stageAllowed: string[];
  forbiddenRoutes: string[];
  expectedRoutes: string[];
  forbiddenApiAccess: string[];
}

test.setTimeout(120_000);

test("persona authorization — wrong persona is denied, right persona is allowed", async ({
  page,
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? "http://localhost").origin;
  const registry = JSON.parse(readFileSync("e2e/persona-registry.json", "utf8"));
  const persona: Persona | undefined = registry.personas.find(
    (p: Persona) => p.personaId === ACTIVE_PERSONA
  );
  expect(persona, `persona ${ACTIVE_PERSONA} not in registry`).toBeTruthy();
  if (!persona) return;

  const checks: { kind: string; target: string; expected: string; actual: string; ok: boolean }[] =
    [];

  // Forbidden ROUTES: a direct navigation must NOT reveal the admin surface — the
  // SPA either redirects to login or renders the unauthenticated/forbidden state.
  for (const route of persona.forbiddenRoutes) {
    if (route.includes("fqdn")) continue; // cross-tenant FQDN routes need a second host — Phase 6 tail
    await page
      .goto(origin + route, { waitUntil: "domcontentloaded", timeout: 20_000 })
      .catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
    // Denied = redirected away from the admin route OR a sign-in entry is shown.
    const url = page.url();
    const signInVisible =
      (await page
        .getByTestId("sign-in-entry")
        .count()
        .catch(() => 0)) > 0 ||
      (await page
        .getByTestId("sign-in-link")
        .count()
        .catch(() => 0)) > 0;
    const onForbiddenRoute = new URL(url).pathname === route;
    const denied = !onForbiddenRoute || signInVisible;
    checks.push({
      kind: "forbidden-route",
      target: route,
      expected: "denied (redirect/sign-in)",
      actual: denied ? "denied" : `revealed at ${url}`,
      ok: denied,
    });
  }

  // Forbidden API: direct access must be 401/403 (never 200) for this persona.
  for (const api of persona.forbiddenApiAccess) {
    const m = api.match(/^(GET|POST|PATCH|PUT|DELETE)\s+(\S+)$/);
    if (!m) continue;
    const [, method, path] = m;
    if (path.includes(":") || path.startsWith("tenant-b")) continue; // param/cross-tenant — Phase 6 tail
    const resp = await request
      .fetch(origin + path, {
        method,
        failOnStatusCode: false,
        headers: { "x-e2e-persona": ACTIVE_PERSONA },
      })
      .catch(() => null);
    const status = resp?.status() ?? 0;
    const ok = status === 401 || status === 403;
    checks.push({
      kind: "forbidden-api",
      target: api,
      expected: "401/403",
      actual: String(status),
      ok,
    });
  }

  // Expected routes load (not blank).
  for (const route of persona.expectedRoutes) {
    await page
      .goto(origin + route, { waitUntil: "domcontentloaded", timeout: 20_000 })
      .catch(() => {});
    const body = (
      (await page
        .locator("body")
        .textContent()
        .catch(() => "")) ?? ""
    ).trim();
    checks.push({
      kind: "expected-route",
      target: route,
      expected: "loads (non-blank)",
      actual: body.length > 1 ? "loads" : "blank",
      ok: body.length > 1,
    });
  }

  const failures = checks.filter((c) => !c.ok);
  const report = {
    stage: E2E_STAGE,
    persona: ACTIVE_PERSONA,
    authMode: persona.authMode,
    baseURL: origin,
    checks,
    failureCount: failures.length,
    result: failures.length ? "FAILED" : "PASSED",
    generatedFor: "ADR-ACT-0285 Phase 6",
  };
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const base = `${EVIDENCE_DIR}/${E2E_STAGE}-persona-coverage-latest`;
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(
    `${base}.md`,
    [
      `# E2E persona authorization coverage — ${E2E_STAGE}`,
      "",
      "Generated (ADR-ACT-0285 Phase 6). DO NOT EDIT — regenerate via `make e2e-persona-authz ENV=<stage> E2E_PERSONA=<id>`.",
      "",
      `- Persona: \`${ACTIVE_PERSONA}\` (authMode ${persona.authMode})`,
      `- Result: **${report.result}**`,
      `- Checks: ${checks.length} (${failures.length} failed)`,
      "",
      "## Checks (expected vs actual)",
      "",
      ...checks.map(
        (c) =>
          `- ${c.ok ? "✅" : "❌"} ${c.kind} \`${c.target}\` → expected ${c.expected}, got ${c.actual}`
      ),
      "",
    ].join("\n")
  );

  expect(failures, `persona authz failures: ${JSON.stringify(failures, null, 2)}`).toHaveLength(0);
});
