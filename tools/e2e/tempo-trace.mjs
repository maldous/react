// ADR-ACT-0285 (closure) — Tempo trace-by-id retrieval + assertion.
//
// Real trace correlation (not liveness): given a traceId extracted from a correlated
// Loki log line, poll Tempo for ingestion, fetch the trace by id, parse the returned
// OpenTelemetry JSON, and assert the expected service/span contract — plus a guard that
// no secret/credential leaked into captured span attributes. Pure Node + fetch; the HTTP
// surface is injectable (fetchImpl/sleepImpl) so it is unit-tested without a live Tempo.

/** A 16- or 32-hex-char OpenTelemetry trace id (lower-cased), or null if invalid. */
export function parseTraceId(raw) {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  return /^[0-9a-f]{16}$|^[0-9a-f]{32}$/.test(t) ? t : null;
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
 *  [{ service, name, kind, attributes:{} }]. */
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
          attributes: attrMap(sp.attributes),
        });
      }
    }
  }
  return spans;
}

const ROUTE_ATTR_KEYS = ["http.route", "http.target", "url.path", "http.url", "url.full"];

// Attribute keys/values that must never appear in captured span attributes.
const SECRET_KEY_RE = /password|secret|token|authorization|cookie|api[-_]?key|bearer/i;

/** Scan span attributes for leaked secrets/credentials. Returns redacted hits.
 *  extraSecrets: concrete secret VALUES (e.g. the E2E password) that must not appear. */
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
 * Returns { ok, missingServices, routeFound, routeRequired, secretHits, services }.
 */
export function assertTraceContract(spans, expected, extraSecrets = []) {
  const services = [...new Set(spans.map((s) => s.service).filter(Boolean))];
  const missingServices = (expected.services ?? []).filter((s) => !services.includes(s));
  let routeFound = true;
  const routeRequired = Boolean(expected.route);
  if (routeRequired) {
    const want = expected.route;
    routeFound = spans.some((sp) =>
      ROUTE_ATTR_KEYS.some((k) => {
        const v = sp.attributes[k];
        return typeof v === "string" && v.includes(want);
      })
    );
  }
  const secretHits = scanForSecrets(spans, extraSecrets);
  const ok = missingServices.length === 0 && routeFound && secretHits.length === 0;
  return {
    ok,
    missingServices,
    routeFound,
    routeRequired,
    secretHits,
    services,
    spanCount: spans.length,
  };
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a trace by id, polling for ingestion (Tempo returns 404 until the trace lands).
 * Returns { reachable, found, status, trace, attempts, error }.
 *   - reachable=false → Tempo could not be contacted at all (network/timeout).
 *   - found=false but reachable=true → repeatedly 404 (or empty) after all attempts.
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
          // 200 with an unparseable body is a malformed response, not a missing trace.
          return {
            reachable,
            found: false,
            status: res.status,
            trace: null,
            attempts: i + 1,
            error: "malformed-json",
          };
        }
        const spanCount = extractSpans(trace).length;
        if (spanCount > 0)
          return {
            reachable,
            found: true,
            status: res.status,
            trace,
            attempts: i + 1,
            error: null,
          };
        // 200 but no spans yet → keep polling (partial ingest).
      }
    } catch (err) {
      lastError = String(err?.message ?? err);
    }
    if (i < attempts - 1) await sleep(intervalMs);
  }
  return { reachable, found: false, status: lastStatus, trace: null, attempts, error: lastError };
}
