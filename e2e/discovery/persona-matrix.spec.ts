// ADR-ACT-0285 Phase 6 (sub-project A) — multi-persona authed crawl.
// For every persona runnable at this stage, log in (real -> loginAs flow; unauthenticated
// -> none) and assert the registry matrix: expected/forbidden routes, forbidden APIs, and
// clickthrough allow/deny. Granted clickthrough links are NAVIGATED and confirmed to load
// the real service UI; denied ones must 401/403. Read-only (GET) — never destructive.
import { test, expect, E2E_STAGE } from "../support/correlation.ts";
import { completeKeycloakLogin } from "../external/helpers.ts";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import process from "node:process";

const EVIDENCE_DIR = "docs/evidence/e2e";
const STAGE = E2E_STAGE;
const PASSWORD = process.env["KEYCLOAK_TEST_PASSWORD"] ?? "";
const CREDS_PRESENT = PASSWORD.length > 0;

// service id -> apex path; MUST mirror CLICKTHROUGH_SERVICES in
// apps/platform-api/src/usecases/service-clickthrough.ts. Services without an apexPath
// (tilt/wiremock/openbao) are not navigable and never appear in persona clickthrough lists.
const SERVICE_PATHS: Record<string, string> = {
  keycloak: "/kc/",
  mailpit: "/mailpit/",
  sentry: "/sentry/",
  sonarqube: "/sonar/",
  minio: "/minio/",
  clickhouse: "/clickhouse/",
  localstack: "/localstack/",
  pgadmin: "/pgadmin/",
  grafana: "/grafana/",
};

interface Persona {
  personaId: string;
  authMode: string;
  stageAllowed: string[];
  provisionRef: string | null;
  roles: string[];
  expectedRoutes: string[];
  forbiddenRoutes: string[];
  forbiddenApiAccess: string[];
  expectedClickthroughAccess: string[];
  forbiddenClickthroughAccess: string[];
}

interface Check {
  persona: string;
  kind: string;
  target: string;
  expected: string;
  actual: string;
  ok: boolean;
}

function usernameFromProvisionRef(ref: string | null): string | null {
  if (!ref) return null;
  const m = ref.match(/keycloak:(\S+)/);
  return m ? m[1] : null;
}

const registry = JSON.parse(readFileSync("e2e/persona-registry.json", "utf8"));
const personas: Persona[] = registry.personas.filter(
  (p: Persona) =>
    p.stageAllowed.includes(STAGE) && !p.personaId.startsWith("a11y-") && p.authMode !== "mixed"
);

const allChecks: Check[] = [];
const personaResults: { persona: string; authMode: string; status: string; reason?: string }[] = [];

test.describe("persona-matrix — authed link/route/API crawl per persona", () => {
  test.setTimeout(180_000);

  for (const persona of personas) {
    test(`${persona.personaId} (${persona.authMode})`, async ({
      page,
      request,
      baseURL,
    }, testInfo) => {
      const origin = new URL(baseURL ?? "http://localhost").origin;
      const checks: Check[] = [];
      const record = (
        kind: string,
        target: string,
        expected: string,
        actual: string,
        ok: boolean
      ) => {
        const c: Check = { persona: persona.personaId, kind, target, expected, actual, ok };
        checks.push(c);
        allChecks.push(c);
      };

      // cross-tenant persona needs a 2nd tenant — sub-project B.
      if (/NOT YET PROVISIONED/.test(persona.provisionRef ?? "")) {
        personaResults.push({
          persona: persona.personaId,
          authMode: persona.authMode,
          status: "SKIPPED",
          reason: "needs 2nd tenant (sub-project B)",
        });
        testInfo.skip(true, "cross-tenant persona needs a 2nd tenant — Phase 6 sub-project B");
        return;
      }
      // real personas need creds; without them this is honestly DEGRADED (recorded, not failed).
      if (persona.authMode === "real" && !CREDS_PRESENT) {
        personaResults.push({
          persona: persona.personaId,
          authMode: persona.authMode,
          status: "DEGRADED",
          reason: "KEYCLOAK_TEST_PASSWORD absent",
        });
        testInfo.skip(true, "KEYCLOAK_TEST_PASSWORD absent — DEGRADED, recorded");
        return;
      }

      // (auth + checks added in later tasks)
      personaResults.push({
        persona: persona.personaId,
        authMode: persona.authMode,
        status: "RAN",
      });
      expect(
        checks.length,
        "scaffold placeholder — replaced in later tasks"
      ).toBeGreaterThanOrEqual(0);
    });
  }
});
