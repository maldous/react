// ADR-ACT-0285 (closure + hardening) — Tempo trace-by-id retrieval + assertion.
//
// Real trace correlation: given a traceId extracted from a correlated Loki log line, poll
// Tempo for ingestion, fetch the trace by id, parse the OpenTelemetry JSON, and assert the
// expected service/span contract — with a per-span trace-membership check, exact/normalised
// route matching, and a guard that no secret leaked into captured span attributes. The HTTP
// surface is injectable (fetchImpl/sleepImpl) so it is unit-tested without a live Tempo.

/** A 32-hex-char (128-bit) OpenTelemetry trace id, lower-cased, or null. 16-hex (span-id
 *  sized) values are REJECTED — a trace id is always 128 bits. */
export function parseTraceId(raw) {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(t) ? t : null;
}

/** Normalise an OTLP traceId that may be hex (32 chars) OR base64 (Tempo JSON default) to
 *  a 32-hex lower-cased id, or null when it cannot be interpreted as a 128-bit id. */
export function normalizeTraceId(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const t = raw.trim();
  if (/^[0-9a-f]{32}$/i.test(t)) return t.toLowerCase();
  try {
    const buf = Buffer.from(t, "base64");
    if (buf.length === 16) return buf.toString("hex");
  } catch {
    /* not base64 */
  }
  return null;
}

function attrMap(attributes) {
  const out = {};
  for (const a of attributes ?? []) {
    if (!a || typeof a.key !== "string") continue;
    const v = a.value ?? {};
    out[a.key] =
      v.stringValue ??
      (v.intValue !== undefined ? String(v.intValue) : undefined) ??
      (v.boolValue !== undefined ? String(v.boolValue) : undefined) ??
      (v.doubleValue !== undefined ? String(v.doubleValue) : undefined) ??
      "";
  }
  return out;
}

/** Flatten a Tempo/OTLP trace JSON (handles `batches` and `resourceSpans`, and both
 *  `scopeSpans` and legacy `instrumentationLibrarySpans`) into a flat span list:
 *  [{ service, name, kind, traceId(normalised|null), spanId, attributes:{} }]. */
export function extractSpans(traceJson) {
  const batches = traceJson?.batches ?? traceJson?.resourceSpans ?? [];
  const spans = [];
  for (const b of batches) {
    const resAttrs = attrMap(b.resource?.attributes);
    const service = resAttrs["service.name"] ?? "";
    const scopes = b.scopeSpans ?? b.instrumentationLibrarySpans ?? [];
    for (const sc of scopes) {
      for (const sp of sc.spans ?? []) {
        spans.push({
          service,
          name: sp.name ?? "",
          kind: sp.kind ?? "",
          traceId: normalizeTraceId(sp.traceId ?? ""),
          spanId: sp.spanId ?? "",
          attributes: attrMap(sp.attributes),
        });
      }
    }
  }
  return spans;
}

const ROUTE_ATTR_KEYS = ["http.route", "http.target", "url.path", "http.url", "url.full"];

/** Normalise a route/path for comparison: take the pathname, strip a trailing slash. */
function normPath(v) {
  if (typeof v !== "string" || !v) return "";
  let p = v;
  try {
    // absolute url → pathname; relative → strip query/hash
    p = v.startsWith("http") ? new URL(v).pathname : v.split(/[?#]/)[0];
  } catch {
    p = v.split(/[?#]/)[0];
  }
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

/** Does any span reference `route` by an EXACT/normalised path match (preferred), with a
 *  guarded substring fallback only when no exact match exists? */
export function routeFoundIn(spans, route) {
  const want = normPath(route);
  if (!want) return true;
  let substringHit = false;
  for (const sp of spans) {
    for (const k of ROUTE_ATTR_KEYS) {
      const v = sp.attributes[k];
      if (typeof v !== "string" || !v) continue;
      if (normPath(v) === want) return true; // exact/normalised
      if (v.includes(route)) substringHit = true; // last-resort fallback
    }
  }
  return substringHit;
}

const SECRET_KEY_RE = /password|secret|token|authorization|cookie|api[-_]?key|bearer/i;

/** Scan span attributes for leaked secrets/credentials. Returns redacted hits. */
export function scanForSecrets(spans, extraSecrets = []) {
  const hits = [];
  const secretVals = extraSecrets.filter((s) => typeof s === "string" && s.length >= 6);
  for (const sp of spans) {
    for (const [k, v] of Object.entries(sp.attributes)) {
      const val = String(v ?? "");
      if (SECRET_KEY_RE.test(k) && val.length > 0)
        hits.push({
          service: sp.service,
          span: sp.name,
          key: k,
          why: "secret-like key carries a value",
        });
      for (const sv of secretVals)
        if (val.includes(sv))
          hits.push({
            service: sp.service,
            span: sp.name,
            key: k,
            why: "carries a known E2E credential value",
          });
    }
  }
  return hits;
}

/**
 * Assert a trace's span set against the expected contract.
 *   expected: { services: string[], route?: string }
 *   opts: { expectedTraceId?: 32-hex, extraSecrets?: string[] }
 * Returns { ok, missingServices, routeFound, routeRequired, secretHits, services,
 *           spanCount, traceIdMismatches }.
 */
export function assertTraceContract(spans, expected, opts = {}) {
  const services = [...new Set(spans.map((s) => s.service).filter(Boolean))];
  const missingServices = (expected.services ?? []).filter((s) => !services.includes(s));
  const routeRequired = Boolean(expected.route);
  const routeFound = routeRequired ? routeFoundIn(spans, expected.route) : true;
  const secretHits = scanForSecrets(spans, opts.extraSecrets ?? []);
  // Every span that carries a parseable traceId must belong to the requested trace.
  const want = opts.expectedTraceId ? parseTraceId(opts.expectedTraceId) : null;
  const traceIdMismatches = want
    ? spans
        .filter((s) => s.traceId && s.traceId !== want)
        .map((s) => ({ service: s.service, span: s.name, traceId: s.traceId }))
    : [];
  const ok =
    missingServices.length === 0 &&
    routeFound &&
    secretHits.length === 0 &&
    traceIdMismatches.length === 0;
  return {
    ok,
    missingServices,
    routeFound,
    routeRequired,
    secretHits,
    services,
    spanCount: spans.length,
    traceIdMismatches,
  };
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a trace by id, polling for ingestion. Returns
 *   { classification: 'found'|'missing'|'degraded', reachable, found, status, trace, attempts, error }
 *   - 'found'      → 200 with ≥1 span (success).
 *   - 'missing'    → reachable, only genuine 404s (or 200-empty) after all attempts → FAILED upstream.
 *   - 'degraded'   → network error / timeout / 5xx / 401/403 / malformed → DEGRADED upstream (could
 *                    not be proven, NOT a genuine absence).
 */
export async function pollTempoTrace(tempoBase, traceId, opts = {}) {
  const attempts = opts.attempts ?? 8;
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleepImpl ?? defaultSleep;
  const url = `${tempoBase}/api/traces/${traceId}`;
  let reachable = false;
  let lastStatus = 0;
  let lastError = null;
  let sawDegrading = false; // network / 5xx / auth / malformed → cannot prove absence
  let saw404 = false;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      reachable = true;
      lastStatus = res.status;
      if (res.ok) {
        let trace = null;
        try {
          trace = await res.json();
        } catch {
          sawDegrading = true; // 200 but unparseable → backend problem, not a clean absence
          lastError = "malformed-json";
          if (i < attempts - 1) await sleep(intervalMs);
          continue;
        }
        if (extractSpans(trace).length > 0)
          return {
            classification: "found",
            reachable,
            found: true,
            status: res.status,
            trace,
            attempts: i + 1,
            error: null,
          };
        // 200 but no spans yet → keep polling (partial ingest).
      } else if (res.status === 404) {
        saw404 = true;
      } else if (res.status >= 500 || res.status === 401 || res.status === 403) {
        sawDegrading = true; // backend/auth/config problem, not a genuine absence
      } else {
        sawDegrading = true;
      }
    } catch (err) {
      lastError = String(err?.message ?? err);
      sawDegrading = true; // network error / timeout
    }
    if (i < attempts - 1) await sleep(intervalMs);
  }
  // After polling: a genuine, repeatable 404 with NO degrading signal = missing (FAILED);
  // anything else (network/5xx/auth/malformed, or never a clean answer) = degraded.
  const classification = saw404 && !sawDegrading ? "missing" : "degraded";
  return {
    classification,
    reachable,
    found: false,
    status: lastStatus,
    trace: null,
    attempts,
    error: lastError,
  };
}

/**
 * Evaluate a trace scenario that may have MULTIPLE candidate trace ids. Does NOT blindly
 * take the first id. Returns { result: 'PASSED'|'FAILED'|'DEGRADED', chosenTraceId, perTrace }.
 *   - expected.allTraceIds === true → EVERY id must satisfy the contract (worst wins).
 *   - otherwise → the FIRST id that satisfies the contract PASSES; else the worst outcome
 *     across all ids (a 'missing' 404 → FAILED beats a 'degraded' only if no id passed).
 */
export async function evaluateTraceScenario(tempoBase, traceIds, expected, opts = {}) {
  const ids = (traceIds ?? []).map(parseTraceId).filter(Boolean);
  if (ids.length === 0)
    return {
      result: "FAILED",
      chosenTraceId: null,
      perTrace: [],
      reason: "no valid 32-hex trace id from Loki",
    };
  const requireAll = expected.allTraceIds === true;
  const perTrace = [];
  let sawMissing = false;
  let sawDegraded = false;
  let allPass = true;
  let firstPass = null;
  for (const id of ids) {
    const poll = await pollTempoTrace(tempoBase, id, opts);
    if (poll.classification !== "found") {
      allPass = false;
      if (poll.classification === "missing") sawMissing = true;
      else sawDegraded = true;
      perTrace.push({
        traceId: id,
        found: false,
        classification: poll.classification,
        error: poll.error,
        status: poll.status,
      });
      if (!requireAll) continue;
      continue;
    }
    const spans = extractSpans(poll.trace);
    const contract = assertTraceContract(spans, expected, {
      expectedTraceId: id,
      extraSecrets: opts.extraSecrets,
    });
    perTrace.push({ traceId: id, found: true, classification: "found", contract });
    if (contract.ok) {
      if (!firstPass) firstPass = id;
      if (!requireAll) return { result: "PASSED", chosenTraceId: id, perTrace };
    } else {
      allPass = false;
    }
  }
  if (requireAll)
    return { result: allPass ? "PASSED" : "FAILED", chosenTraceId: firstPass, perTrace };
  if (firstPass) return { result: "PASSED", chosenTraceId: firstPass, perTrace };
  // No id passed the contract: a genuine 404 absence is FAILED; otherwise DEGRADED.
  const result = sawMissing ? "FAILED" : sawDegraded ? "DEGRADED" : "FAILED";
  return { result, chosenTraceId: null, perTrace };
}
