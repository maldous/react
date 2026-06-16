#!/usr/bin/env node
// ADR-ACT-0285 Phase 5.5 — self-hosted Sentry API event assertion.
//
// Triggers the gated synthetic-failure endpoint (POST /internal/e2e/trigger-failure)
// with a unique testRunId/scenarioId, then queries the self-hosted Sentry API to
// PROVE the failure was captured and is queryable with the right correlation
// metadata: environment, release (when configured), requestId, traceId, and the
// E2E testRunId/scenarioId tags. In prod it also runs a "no-unexpected-events" gate.
//
// Honest results (mirrors Phase 5 failure-rootcause):
//   PASSED   — Sentry reachable and the event carries the required metadata.
//   FAILED   — Sentry reachable but the event is missing/has wrong metadata
//              (or, in prod, unexpected events appeared). Exit 1 — blocks `make all`.
//   DEGRADED — API/Sentry not reachable or not configured for the stage. Exit 0.
//
// Writes docs/evidence/e2e/<stage>-sentry-events-latest.{json,md}. Pure Node + fetch.
// The Sentry API token is read from env and sent only in the Authorization header —
// it is NEVER written to evidence or logs.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { runAssertion } from "./lib.mjs";

const ROOT = resolve(".");
const STAGE = (process.env["STAGE"] || process.env["E2E_STAGE"] || "local").toLowerCase();
const EVIDENCE_DIR = join(ROOT, "docs/evidence/e2e");

function envValue(key) {
  if (process.env[key] !== undefined && process.env[key] !== "") return process.env[key];
  const f = join(ROOT, ".env", `${STAGE}.env`);
  if (!existsSync(f)) return undefined;
  const m = new RegExp(`^${key}=(.*)$`, "m").exec(readFileSync(f, "utf8"));
  return m ? m[1].replace(/^["']|["']$/g, "") : undefined;
}

function apiBase() {
  if (process.env["SENTRY_ASSERT_API_URL"]) return process.env["SENTRY_ASSERT_API_URL"];
  const port = envValue("PLATFORM_API_PORT") || "3001";
  return `http://localhost:${port}`;
}

function sentryConfig() {
  const baseUrl = envValue("SENTRY_API_BASE_URL");
  const token = envValue("SENTRY_API_TOKEN");
  const orgSlug = envValue("SENTRY_ORG_SLUG") || "sentry";
  const projectSlug = envValue("SENTRY_PROJECT_SLUG") || "react-sentry";
  if (!baseUrl || !token) return null;
  return { baseUrl, token, orgSlug, projectSlug };
}

function write(name, payload) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const base = join(EVIDENCE_DIR, `${STAGE}-${name}-latest`);
  writeFileSync(`${base}.json`, JSON.stringify(payload, null, 2) + "\n");
  const md = [
    `# E2E ${name} — ${STAGE}`,
    "",
    "Generated (ADR-ACT-0285 Phase 5.5). DO NOT EDIT — regenerate via make e2e-sentry-assertion.",
    "",
    `- Result: **${payload.result}**`,
    ...(payload.lines ?? []).map((l) => `- ${l}`),
    "",
  ];
  writeFileSync(`${base}.md`, md.join("\n"));
}

const stamp = process.env["E2E_TEST_RUN_ID"] || `sentry-${STAGE}-${Date.now()}`;
const platformEnv = envValue("PLATFORM_ENV");

const config = {
  stage: STAGE,
  isProd: (platformEnv || "") === "production" || STAGE === "prod",
  apiBase: apiBase(),
  sentry: sentryConfig(),
  testRunId: stamp,
  scenarioId: process.env["E2E_SCENARIO_ID"] || "synthetic-failure-sentry-capture",
  expectedEnvironment: platformEnv || undefined,
  expectedRelease: envValue("APP_VERSION") || undefined,
  // Self-hosted Sentry ingest+snuba-index latency: a group is created quickly but the
  // tag SEARCH can lag, so default to ~80s of polling (12 × 6s after a 6s warm-up). The
  // gate still DEGRADES honestly if Sentry is unreachable — it never hangs make all.
  triggerWaitMs: Number(process.env["SENTRY_ASSERT_INGEST_WAIT_MS"] ?? 6000),
  pollAttempts: Number(process.env["SENTRY_ASSERT_POLL_ATTEMPTS"] ?? 12),
  pollIntervalMs: Number(process.env["SENTRY_ASSERT_POLL_INTERVAL_MS"] ?? 6000),
};

const payload = await runAssertion(
  { fetchImpl: fetch, sleep: (ms) => sleep(ms), log: () => {}, now: () => Date.now() },
  config
);

write("sentry-events", payload);

const tag =
  payload.result === "PASSED"
    ? "\x1b[32m✓\x1b[0m"
    : payload.result === "FAILED"
      ? "\x1b[31m✗\x1b[0m"
      : "\x1b[33m⚠\x1b[0m";
console.log(
  `${tag} e2e sentry-assertion: ${payload.result} → docs/evidence/e2e/${STAGE}-sentry-events-latest.md`
);
for (const line of payload.lines) console.log(`  • ${line}`);

process.exit(payload.result === "FAILED" ? 1 : 0);
