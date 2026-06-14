# Browser-side diagnostics (Grafana Faro)

Source ADR: ADR-0074 · Action: ADR-ACT-0277

Real-user browser telemetry for the React app — errors, unhandled rejections,
Web Vitals, page views, and session metadata — shipped to the same Loki backend
as the server-side Pino logs, with no new public surface and no CSP exception.

## Architecture

```text
React app (Faro Web SDK, initFaro() in main.tsx)
    │  POST /faro/collect   (relative → same origin; CSP connect-src 'self' OK)
    ▼
Caddy  handle_path /faro/*  → reverse_proxy alloy:12347   (strips /faro → /collect)
    ▼
Alloy  faro.receiver "browser"  (:12347)
    │  output.logs
    ▼
loki.process "faro_logs"  → labels service=react-enterprise-app, source=faro, environment
    ▼
loki.write "platform_loki"  → Loki   (beside the server Pino logs)
```

## Why these choices

- **Same-origin collector.** Faro POSTs to the relative `/faro/collect`; Caddy
  proxies it to the env's Alloy receiver. Same-origin means the existing CSP
  (`connect-src 'self'`) is untouched — no allow-list entry, no exposed host.
- **Failure-tolerant init.** `initFaro()` is idempotent and wraps init in a
  try/catch that swallows errors — diagnostics can never break app bootstrap.
- **One bundle, all environments.** The collector URL defaults to a relative
  path and the `environment` label is derived from `window.location.hostname`
  at runtime, so dev/test/staging/prod share a single build (no Vite build arg).
- **Loki label policy (ADR-0035).** Only low-cardinality labels are promoted
  (`service`, `source=faro`, `environment`); the rest stays in the Faro payload.
- **No tracing (yet).** Web instrumentations only; the collector is a logs
  pipeline. Distributed tracing is a documented follow-up behind the same receiver.

## Wiring (delivered)

- `apps/react-enterprise-app/src/observability/faro.ts` — `initFaro()` / `getFaro()`.
- `apps/react-enterprise-app/src/main.tsx` — `initFaro()` before `createRoot`.
- `@grafana/faro-web-sdk` (devDependency, bundled by Vite).
- `docker/alloy/config.alloy` — `faro.receiver "browser"` + `loki.process "faro_logs"`.
- `docker/caddy/Caddyfile` — `handle_path /faro/*` in each SPA vhost (3).

## Verification (static — this slice)

- `vite build` — Faro Web SDK bundles into the SPA cleanly.
- `alloy fmt` — receiver config valid.
- `caddy validate` — Caddyfile valid with the `/faro/*` proxy.
- `npm run compose:config` — compose valid.
- architecture orchestrator `all` — package metadata + import boundaries green.

## Not delivered

- `proof:faro-browser-diagnostics` (live): synthetic browser error → `/faro/collect`
  → Alloy → a `source="faro"` line in Loki. Deferred — needs a running web stack +
  headless browser.
- Distributed tracing (`@grafana/faro-web-tracing` + traces pipeline to the default
  `otel-collector`/Tempo).
- Per-environment `VITE_FARO_*` build-arg pipeline (runtime default covers correctness).
- Source-map upload / stack-trace symbolication.
- A dedicated Grafana dashboard for the browser RUM stream.

## Linkage

ADR-0074 · ADR-ACT-0277 · builds on ADR-0035 (Loki labels) and the existing
Alloy → Loki server-log pipeline.
