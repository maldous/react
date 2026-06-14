# ADR-0074: Browser-side diagnostics via Grafana Faro

## Status

Accepted

## Date

2026-06-14

## Decision owner

Architecture owner / platform

## Consulted

ADR-0001 (hexagonal/app-shell ownership), ADR-0035 (Loki label policy),
ADR-0027 (Tilt/local loop), ADR-0072 (environment substrate), the existing
Alloy → Loki server-log pipeline (`docker/alloy/config.alloy`).

## Context

The platform had rich **server-side** observability (Pino → Alloy → Loki, with
the ADR-0035 low/high-cardinality label policy) but **no browser-side
diagnostics**. Client-only failures — uncaught exceptions, unhandled promise
rejections, failed fetches, slow Web Vitals, and "the page just shows an error"
reports — were invisible to operators. The recent operator-console access
incident was diagnosed only by driving a headless browser manually; there was no
real-user telemetry to consult.

We want first-class browser diagnostics that:

- capture errors, console errors, Web Vitals, page views, and session metadata
  from the real React app in every environment;
- land in the **same** observability backend (Loki) as the server logs, so an
  operator can correlate a browser error with the server request;
- do not require a new public endpoint or a CSP exception;
- are safe by construction (never break app bootstrap, off-switchable);
- need no per-environment rebuild (one bundle serves dev/test/staging/prod).

## Decision

Adopt the **Grafana Faro Web SDK** in the React app, shipping browser telemetry
to this environment's **Alloy `faro.receiver`**, which forwards it to Loki.

1. **App SDK** (`apps/react-enterprise-app/src/observability/faro.ts`):
   `initFaro()` runs at the very top of `main.tsx`, before React renders. It is
   idempotent and failure-tolerant — any init error is swallowed so diagnostics
   can never take the app down. Default browser instrumentations only (errors,
   unhandled rejections, Web Vitals, page views, session). **No distributed
   tracing** — the collector is a logs pipeline; tracing is a documented
   follow-up behind the same receiver.

2. **Same-origin collector.** The SDK POSTs to the relative path
   **`/faro/collect`**. Caddy reverse-proxies `/faro/*` (prefix stripped) to the
   environment's Alloy `faro.receiver` on `:12347`. Because the collector is
   same-origin, the existing CSP (`connect-src 'self'`) is unchanged — no new
   allow-list entry, no separate exposed host.

3. **Alloy receiver → Loki.** `faro.receiver "browser"` outputs logs to a
   `loki.process` that stamps low-cardinality labels (`service=react-enterprise-app`,
   `source=faro`, `environment`) per the ADR-0035 policy, then to the existing
   `loki.write` target. Browser signals sit alongside server logs in Loki.

4. **One bundle, all environments.** The collector URL defaults to a relative
   path and the `environment` label is derived from the request host at runtime,
   so no per-environment Vite build argument is required. `VITE_FARO_ENABLED`
   (default on) and `VITE_FARO_COLLECTOR_URL` remain available as build-time
   overrides for a future opt-out / external-collector wiring.

## Consequences

- Operators get real-user browser diagnostics in Grafana/Loki with no new public
  surface and no CSP relaxation.
- Telemetry is best-effort: if the receiver is down or the env disables it, the
  SDK silently no-ops; the app is unaffected.
- The Faro Web SDK adds ~weight to the SPA bundle (the existing >500 kB chunk
  warning is unchanged in character); code-splitting remains a separate concern.

## Not delivered (follow-ups)

- Distributed tracing (`@grafana/faro-web-tracing` + a traces pipeline to the
  default `otel-collector`/Tempo) — receiver and CSP already accommodate it.
- A build-arg pipeline to set `VITE_FARO_*` per environment (the runtime default
  covers correctness today).
- Source-map upload / symbolication for minified stack traces.
- A dedicated Grafana dashboard for the `source="faro"` stream.

## Proof

`proof:faro-browser-diagnostics` (deferred — requires a running web stack +
headless browser): asserts the SPA bundle initialises Faro, a synthetic browser
error reaches `/faro/collect`, Caddy proxies it to the Alloy receiver, and a
`source="faro"` line appears in Loki. Statically validated now: `vite build`
(SDK bundles), `alloy fmt`, `caddy validate`, `npm run compose:config`.

## Linkage

ADR-0035 (Loki labels) · ADR-0072 (env substrate) · ADR-ACT-0277.
