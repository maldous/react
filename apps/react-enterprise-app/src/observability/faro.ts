// apps/react-enterprise-app/src/observability/faro.ts
//
// Grafana Faro browser-side diagnostics (ADR-0074).
//
// Initialises the Faro Web SDK so the React app reports real-user telemetry —
// uncaught errors + unhandled rejections, console errors, Web Vitals, page
// views, and session metadata — to the platform observability stack. Faro POSTs
// to a SAME-ORIGIN collector path (`/faro/collect`), which Caddy reverse-proxies
// to this environment's Alloy `faro.receiver`, which forwards the signals to Loki
// (alongside the server-side Pino logs). Keeping the collector same-origin means
// the existing CSP (`connect-src 'self'`) needs no exception.
//
// Design constraints honoured:
//   - No-op + safe when disabled (VITE_FARO_ENABLED="false") or already started.
//   - One build serves every environment: the collector URL defaults to a
//     relative path and the `environment` label is derived from the host at
//     runtime, so no per-environment build argument is required.
//   - Never throws into bootstrap: any init failure is swallowed (diagnostics
//     must never take the app down).

import { initializeFaro, getWebInstrumentations, type Faro } from "@grafana/faro-web-sdk";

let faro: Faro | undefined;

/** Map the request host to a stable environment label (one bundle, all envs). */
function resolveEnvironment(host: string): string {
  const fromBuild = import.meta.env["VITE_FARO_ENVIRONMENT"];
  if (typeof fromBuild === "string" && fromBuild.length > 0) return fromBuild;
  if (host === "aldous.info" || host.endsWith(".aldous.info")) {
    return host.startsWith("staging.") ? "staging" : "production";
  }
  if (host.includes("test.localhost")) return "test";
  if (host.includes("dev.localhost") || host === "localhost") return "development";
  return "local";
}

/**
 * Initialise Faro browser diagnostics. Idempotent and failure-tolerant — safe to
 * call once at the very top of bootstrap, before React renders. Returns the Faro
 * instance (or undefined when disabled / unavailable).
 */
export function initFaro(): Faro | undefined {
  if (faro) return faro;
  if (typeof window === "undefined") return undefined;

  // Opt-out switch (default ON). Built into the bundle by Vite.
  if (import.meta.env["VITE_FARO_ENABLED"] === "false") return undefined;

  const collectorUrl = import.meta.env["VITE_FARO_COLLECTOR_URL"] ?? "/faro/collect";
  const appVersion = import.meta.env["VITE_APP_VERSION"] ?? "0.1.0";

  try {
    faro = initializeFaro({
      url: collectorUrl,
      app: {
        name: "react-enterprise-app",
        version: String(appVersion),
        environment: resolveEnvironment(window.location.hostname),
      },
      // Default browser diagnostics: errors, unhandled rejections, console
      // errors, Web Vitals, page views, and session tracking. No distributed
      // tracing (the collector is a logs pipeline) — that is a documented
      // follow-up behind the same receiver.
      instrumentations: [...getWebInstrumentations({ captureConsole: false })],
    });
    return faro;
  } catch {
    // Diagnostics must never break the app. Stay silent (no console — ADR-0001
    // app-runtime logging rules); a failed init simply means no RUM this load.
    return undefined;
  }
}

/** The active Faro instance, if initialised. */
export function getFaro(): Faro | undefined {
  return faro;
}
