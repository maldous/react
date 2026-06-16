// ADR-ACT-0285 Phase 5.5 — pure logic for the self-hosted Sentry API event
// assertion. No fs / network / process access lives here so it is unit-testable
// with an injected fetch + clock (see tests/sentry-assertion.test.mjs).

/** Flatten a Sentry event's `tags` array ([{key,value}, …]) to a plain map. */
export function tagsToMap(event) {
  const map = {};
  for (const t of event?.tags ?? []) {
    if (t && typeof t.key === "string") map[t.key] = t.value;
  }
  return map;
}

/**
 * Assert a captured Sentry event carries the correlation metadata Phase 5.5
 * requires. `expected.tags` values that are defined are matched exactly; tags
 * listed in `expected.requireTags` must merely be present (their value is
 * generated at runtime, e.g. trace_id). `release` is only asserted when an
 * expected value is supplied (APP_VERSION may be unset in some stages).
 *
 * Returns { ok, failures: string[], checks: object[] } — never throws.
 */
export function assertEventMetadata({ event, expected }) {
  const checks = [];
  const failures = [];
  const tags = tagsToMap(event);

  // environment — assert only when we know what to expect.
  if (expected.environment) {
    const actual = event?.environment ?? null;
    checks.push({ name: "environment", expected: expected.environment, actual });
    if (actual !== expected.environment) {
      failures.push(
        `environment mismatch (expected ${expected.environment}, got ${actual ?? "none"})`
      );
    }
  } else {
    checks.push({ name: "environment", note: "not asserted", actual: event?.environment ?? null });
  }

  // release — only asserted when APP_VERSION / expected.release is configured.
  if (expected.release) {
    const actual = event?.release ?? null;
    checks.push({ name: "release", expected: expected.release, actual });
    if (actual !== expected.release) {
      failures.push(`release mismatch (expected ${expected.release}, got ${actual ?? "none"})`);
    }
  } else {
    checks.push({
      name: "release",
      note: "not asserted (no release configured)",
      actual: event?.release ?? null,
    });
  }

  // Exact-match tags (requestId, testRunId, scenarioId — values we control).
  for (const [key, exp] of Object.entries(expected.tags ?? {})) {
    if (exp === undefined || exp === null) continue;
    const actual = tags[key] ?? null;
    checks.push({ name: `tag:${key}`, expected: exp, actual });
    if (actual !== exp) {
      failures.push(`tag ${key} mismatch (expected ${exp}, got ${actual ?? "none"})`);
    }
  }

  // Presence-only tags (trace_id — generated per request).
  for (const key of expected.requireTags ?? []) {
    const actual = tags[key] ?? null;
    checks.push({ name: `tag:${key}`, present: actual != null, actual });
    if (actual == null) failures.push(`tag ${key} missing`);
  }

  return { ok: failures.length === 0, failures, checks };
}

/**
 * From a Sentry project-issues search response, pick the issue id most likely
 * to be the synthetic failure (newest lastSeen). Returns null when empty.
 */
export function pickIssueId(issues) {
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const sorted = [...issues].sort((a, b) =>
    String(b?.lastSeen ?? "").localeCompare(String(a?.lastSeen ?? ""))
  );
  return sorted[0]?.id ?? null;
}

/**
 * Prod "no-unexpected-events" gate: from issues seen in the window, return any
 * that are NOT our synthetic event (by testRunId tag) and were first seen at or
 * after the run start — i.e. genuinely unexpected new errors. `windowStartMs`
 * and each issue's `firstSeen` are compared as epoch ms.
 */
export function findUnexpectedIssues({ issues, ourTestRunId, windowStartMs }) {
  const unexpected = [];
  for (const issue of issues ?? []) {
    const tags = tagsToMap(issue);
    if (tags["testRunId"] === ourTestRunId) continue; // our own synthetic failure
    const firstSeenMs = Date.parse(issue?.firstSeen ?? "");
    if (Number.isFinite(firstSeenMs) && firstSeenMs >= windowStartMs) {
      unexpected.push({
        id: issue?.id ?? null,
        title: issue?.title ?? null,
        firstSeen: issue?.firstSeen ?? null,
      });
    }
  }
  return unexpected;
}

/**
 * Orchestrate trigger → poll Sentry → assert. Pure of fs/process; all effects
 * are injected via `deps` so this runs deterministically under test.
 *
 * deps: { fetchImpl, sleep, log, now }
 * config: { stage, isProd, apiBase, sentry: { baseUrl, token, orgSlug, projectSlug } | null,
 *           testRunId, scenarioId, expectedEnvironment, expectedRelease,
 *           triggerWaitMs, pollAttempts, pollIntervalMs }
 *
 * Returns the evidence payload { stage, testRunId, result, checks[], lines[], generatedFor }.
 */
export async function runAssertion(deps, config) {
  const { fetchImpl, sleep, log, now } = deps;
  const out = {
    stage: config.stage,
    testRunId: config.testRunId,
    result: "DEGRADED",
    checks: [],
    lines: [],
    generatedFor: "ADR-ACT-0285 Phase 5.5",
  };
  const note = (line) => {
    out.lines.push(line);
    if (log) log(line);
  };
  const windowStartMs = now();

  // --- 1. Trigger the gated synthetic failure (correlated via E2E headers) ---
  let requestId = null;
  try {
    const res = await fetchImpl(`${config.apiBase}/internal/e2e/trigger-failure`, {
      method: "POST",
      headers: {
        "x-e2e-test-run-id": config.testRunId,
        "x-e2e-scenario-id": config.scenarioId,
        "x-e2e-stage": config.stage,
      },
      signal: AbortSignal.timeout(8000),
    });
    requestId = res.headers?.get?.("x-request-id") ?? null;
    out.checks.push({
      name: "trigger-synthetic-failure",
      httpStatus: res.status,
      requestId,
      expected: 500,
    });
    if (res.status === 404) {
      note(
        "Synthetic-failure endpoint returned 404 — E2E_FAILURE_ENDPOINT_ENABLED not set for this stage; cannot assert — DEGRADED."
      );
      return out;
    }
    if (res.status !== 500) {
      note(
        `Synthetic-failure trigger returned HTTP ${res.status} (expected 500); proceeding to query anyway.`
      );
    } else {
      note(`Triggered synthetic failure → HTTP 500 (x-request-id=${requestId ?? "none"}).`);
    }
  } catch (err) {
    note(`Could not reach API to trigger synthetic failure: ${err.message} — DEGRADED.`);
    return out;
  }

  // --- 2. Sentry API must be configured to assert anything ---
  if (!config.sentry || !config.sentry.baseUrl || !config.sentry.token) {
    note(
      `Sentry API not configured for stage ${config.stage} (need SENTRY_API_BASE_URL + SENTRY_API_TOKEN) — DEGRADED.`
    );
    return out;
  }

  // Allow Sentry ingest before querying.
  if (config.triggerWaitMs > 0) await sleep(config.triggerWaitMs);

  const sentryGet = async (path, query) => {
    const u = new URL(`${config.sentry.baseUrl.replace(/\/$/, "")}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v);
    const res = await fetchImpl(u, {
      headers: { authorization: `Bearer ${config.sentry.token}`, accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`sentry ${res.status}`);
    return res.json();
  };

  const { orgSlug, projectSlug } = config.sentry;

  // --- 3. Poll the project issues for our testRunId, then load latest event ---
  let event = null;
  try {
    for (let attempt = 1; attempt <= config.pollAttempts; attempt++) {
      const issues = await sentryGet(`/api/0/projects/${orgSlug}/${projectSlug}/issues/`, {
        query: `testRunId:${config.testRunId}`,
        // Self-hosted Sentry (26.x) only accepts statsPeriod of '', '24h', or '14d' —
        // "1h" is rejected with "Invalid stats_period". 24h safely covers a test window.
        statsPeriod: "24h",
      });
      const issueId = pickIssueId(issues);
      if (issueId) {
        event = await sentryGet(`/api/0/issues/${issueId}/events/latest/`, {});
        break;
      }
      if (attempt < config.pollAttempts) await sleep(config.pollIntervalMs);
    }
  } catch (err) {
    note(
      `Sentry API unreachable while querying for the event: ${err.message} — DEGRADED (not a pass).`
    );
    return out;
  }

  if (!event) {
    out.result = "FAILED";
    note(
      `FAILED: Sentry is reachable but NO event tagged testRunId:${config.testRunId} was found after ${config.pollAttempts} attempt(s) — the synthetic failure was not captured/queryable.`
    );
    return out;
  }

  // --- 4. Assert the event carries the required correlation metadata ---
  const verdict = assertEventMetadata({
    event,
    expected: {
      environment: config.expectedEnvironment,
      release: config.expectedRelease,
      tags: { requestId, testRunId: config.testRunId, scenarioId: config.scenarioId },
      requireTags: ["trace_id"],
    },
  });
  out.checks.push({
    name: "event-metadata",
    eventId: event?.eventID ?? event?.id ?? null,
    ...verdict,
  });
  if (!verdict.ok) {
    out.result = "FAILED";
    note(
      `FAILED: captured Sentry event is missing/wrong metadata: ${verdict.failures.join("; ")}.`
    );
    return out;
  }
  note(
    `Sentry event ${event?.eventID ?? event?.id ?? "?"} carries environment + requestId + trace_id + testRunId + scenarioId.`
  );

  // --- 5. Prod-only no-unexpected-events gate ---
  if (config.isProd) {
    try {
      const issues = await sentryGet(`/api/0/projects/${orgSlug}/${projectSlug}/issues/`, {
        query: "environment:production",
        statsPeriod: "24h", // see note above — self-hosted Sentry rejects "1h".
      });
      const unexpected = findUnexpectedIssues({
        issues,
        ourTestRunId: config.testRunId,
        windowStartMs,
      });
      out.checks.push({
        name: "prod-no-unexpected-events",
        unexpectedCount: unexpected.length,
        unexpected,
      });
      if (unexpected.length > 0) {
        out.result = "FAILED";
        note(
          `FAILED: prod no-unexpected-events gate — ${unexpected.length} unexpected error(s) first seen during the E2E window.`
        );
        return out;
      }
      note(
        "Prod no-unexpected-events gate OK: no unexpected errors first seen during the E2E window."
      );
    } catch (err) {
      note(
        `Prod no-unexpected-events gate could not query Sentry: ${err.message} — DEGRADED (not a pass).`
      );
      return out;
    }
  }

  out.result = "PASSED";
  return out;
}
