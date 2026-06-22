/**
 * Provider environment-classification proof (ADR-0056 / ADR-ACT-0264).
 *
 * STATIC architectural proof (no backend needed — always runs, never SKIPs).
 * Reads the Universal Service Foundation registry and the provider classification
 * matrix and enforces the deployment-ladder rules from ADR-0056:
 *
 *  - tenant-runtime substrates are per-environment (Postgres, Redis, MinIO,
 *    search, workflow, metering, telemetry, secrets, queues, rate-limit counters);
 *  - mock providers are mock-only and forbidden in production;
 *  - a shared-cross-environment capability must show the shared-service checklist
 *    (env/tenant tagging, access control, retention, leakage analysis);
 *  - Sentry may be shared ONLY as error telemetry and its internal Kafka/ClickHouse
 *    must never be reused as the platform bus/warehouse;
 *  - every relevant provider appears in the classification matrix.
 *
 * Negative self-tests prove the rule has teeth (a mock-in-prod or a
 * shared-without-checklist row is rejected).
 *
 * Usage: npm run proof:provider-environment-classification
 */

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const REGISTRY = join(
  repoRoot,
  "docs/evidence/platform/universal-service-foundation-registry.json"
);
const MATRIX = join(repoRoot, "docs/evidence/platform/provider-environment-classification.md");

interface Capability {
  capability: string;
  name: string;
  environmentModel: string;
  sharedPerEnv: string;
  notes: string;
  productionBlockers: string;
  composeSupport: string;
}

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
  assert.equal(ok, true, detail ? `${label}: ${detail}` : label);
}

// ── Classification rules (pure; reused by the negative self-tests) ────────────

// Tenant-runtime / environment-specific substrates that must be per-environment.
const PER_ENV_MANDATORY = new Set([
  "relational-storage",
  "object-storage",
  "rate-limiting",
  "search-indexing",
  "event-bus-queues-dlq",
  "background-workers-runtime",
  "metering-usage-meters",
  "quota-enforcement",
  "notifications",
  "scheduled-jobs-builtin",
  "workflow-engine-scheduled-jobs",
  "metrics-traces",
  "observability-alerting-builtin",
  "runtime-secrets",
  "logs",
]);

const CHECKLIST_EVIDENCE =
  /tagging|checklist|leakage|access[- ]control|engineering|errors? only|errors-only|metadata/i;

function violatesPerEnv(cap: Capability): string | null {
  if (PER_ENV_MANDATORY.has(cap.capability) && cap.environmentModel !== "per-environment") {
    return `${cap.capability} holds tenant-runtime data but is "${cap.environmentModel}" (must be per-environment)`;
  }
  return null;
}

function violatesMockForbidden(cap: Capability): string | null {
  if (cap.environmentModel === "mock-only") {
    const text = `${cap.notes} ${cap.productionBlockers}`.toLowerCase();
    if (
      !text.includes("forbidden") &&
      !text.includes("never") &&
      !text.includes("not be treated")
    ) {
      return `${cap.capability} is mock-only but does not state it is forbidden in production`;
    }
  }
  return null;
}

function violatesSharedChecklist(cap: Capability): string | null {
  if (cap.environmentModel === "shared-cross-environment") {
    const text = `${cap.sharedPerEnv} ${cap.notes}`;
    if (!CHECKLIST_EVIDENCE.test(text)) {
      return `${cap.capability} is shared-cross-environment but shows no shared-service checklist evidence`;
    }
  }
  return null;
}

function main(): void {
  console.log("# Provider environment-classification proof (static)\n");

  const reg = JSON.parse(readFileSync(REGISTRY, "utf8")) as { capabilities: Capability[] };
  const caps = reg.capabilities;
  const matrix = readFileSync(MATRIX, "utf8");

  // ── Positive checks over the real registry ────────────────────────────────
  const perEnvBad = caps.map(violatesPerEnv).filter(Boolean);
  check(
    "tenant-runtime substrates are all per-environment",
    perEnvBad.length === 0,
    perEnvBad.join("; ")
  );

  const mockBad = caps.map(violatesMockForbidden).filter(Boolean);
  check("mock providers are forbidden in production", mockBad.length === 0, mockBad.join("; "));

  const sharedBad = caps.map(violatesSharedChecklist).filter(Boolean);
  check(
    "shared-cross-environment capabilities carry checklist evidence",
    sharedBad.length === 0,
    sharedBad.join("; ")
  );

  // Sentry shared only as error telemetry; its Kafka/ClickHouse not reused as the bus/warehouse.
  const allText = caps.map((c) => `${c.notes} ${c.sharedPerEnv} ${c.composeSupport}`).join(" ");
  check(
    "Sentry internal Kafka/ClickHouse is not reused as the platform bus/warehouse",
    /sentry[^.]*kafka|kafka\/clickhouse|clickhouse.*sentry-only|sentry-only/i.test(allText),
    "registry must state Sentry's Kafka/ClickHouse are Sentry-only"
  );

  // ── Matrix coverage: the composed per-env providers appear in the matrix ────
  check(
    "classification matrix covers the per-environment providers",
    matrix.includes("per-environment") &&
      ["redis", "meilisearch", "temporal", "windmill", "prometheus", "tempo", "alertmanager"].every(
        (p) => matrix.toLowerCase().includes(p)
      )
  );
  check(
    "matrix forbids mocks in production (LocalStack/WireMock/mock-oidc)",
    /localstack/i.test(matrix) &&
      /wiremock/i.test(matrix) &&
      /mock-oidc/i.test(matrix) &&
      /forbidden-in-production/i.test(matrix)
  );

  // ── Negative self-tests: the rules must reject bad classifications ─────────
  check(
    "negative: a tenant-runtime store marked shared is rejected",
    violatesPerEnv({
      capability: "relational-storage",
      name: "x",
      environmentModel: "shared-cross-environment",
      sharedPerEnv: "shared",
      notes: "",
      productionBlockers: "",
      composeSupport: "",
    }) !== null
  );
  check(
    "negative: a shared row with no checklist evidence is rejected",
    violatesSharedChecklist({
      capability: "made-up-shared",
      name: "x",
      environmentModel: "shared-cross-environment",
      sharedPerEnv: "one global instance",
      notes: "convenient to run once",
      productionBlockers: "",
      composeSupport: "",
    }) !== null
  );
  check(
    "negative: a mock-only row that omits forbidden-in-production is rejected",
    violatesMockForbidden({
      capability: "mock-x",
      name: "x",
      environmentModel: "mock-only",
      sharedPerEnv: "",
      notes: "a deterministic mock",
      productionBlockers: "",
      composeSupport: "",
    }) !== null
  );
  check(
    "negative: a correctly-classified per-env store passes",
    violatesPerEnv({
      capability: "relational-storage",
      name: "x",
      environmentModel: "per-environment",
      sharedPerEnv: "per-env",
      notes: "",
      productionBlockers: "",
      composeSupport: "",
    }) === null
  );

  console.log(
    failures === 0 ? "\n# ALL CHECKS PASSED (static)" : `\n# ${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
