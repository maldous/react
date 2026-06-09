import path from "node:path";
import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API_PORT = process.env["PLATFORM_API_PORT"] ?? "3001";
const KC_PORT = process.env["KEYCLOAK_PORT"] ?? "8090";
const MAILPIT_PORT = process.env["MAILPIT_UI_PORT"] ?? "8025";
const MINIO_PORT = process.env["MINIO_CONSOLE_PORT"] ?? "9001";
const SONAR_PORT = process.env["SONAR_PORT"] ?? "9003";
const WIREMOCK_PORT = process.env["WIREMOCK_PORT"] ?? "8089";
const CH_PORT = process.env["CLICKHOUSE_HTTP_PORT"] ?? "8124";
const GRAFANA_PORT = process.env["GRAFANA_PORT"] ?? "3200";
const PGADMIN_PORT = process.env["PGADMIN_PORT"] ?? "5050";
// Sentry runs in its own compose project (react-sentry, profile external-sentry)
// on a fixed host port (compose.yaml: "9060:9000"). Override only if you remap.
const SENTRY_PORT = process.env["SENTRY_HOST_PORT"] ?? "9060";

// Shared BFF proxy entries — used by both server (dev) and preview (prod build) modes.
// /auth proxy is required for POST /auth/logout to reach platform-api in dev mode
// (Caddy handles /auth/* in deployed environments; Vite does not).
// Admin tool paths (/kc, /mailpit, etc.) proxy directly to the local services
// so they work in dev mode without Caddy. Caddy handles path-stripping in deployment;
// Vite mirrors this via the rewrite function where needed.
const bffProxy = {
  // Sentry auth login — must appear BEFORE the /auth catch-all so
  // /auth/login/sentry/ routes to sentry, not platform-api.
  "/auth/login": {
    target: `http://localhost:${SENTRY_PORT}`,
    changeOrigin: true,
  },
  // Sentry static assets — Django's STATIC_URL is /_static/<version>/
  // and these are referenced without the /sentry prefix in page HTML.
  "/_static": {
    target: `http://localhost:${SENTRY_PORT}`,
    changeOrigin: true,
  },
  "/auth": {
    target: `http://localhost:${API_PORT}`,
    changeOrigin: true,
  },
  "/api": {
    target: `http://localhost:${API_PORT}`,
    changeOrigin: true,
  },
  "/healthz": {
    target: `http://localhost:${API_PORT}`,
    changeOrigin: true,
  },
  "/readyz": {
    target: `http://localhost:${API_PORT}`,
    changeOrigin: true,
  },
  "/version": {
    target: `http://localhost:${API_PORT}`,
    changeOrigin: true,
  },
  // Admin tools — mirror Caddy routes; strip prefix where Caddy does the same
  "/kc": {
    target: `http://localhost:${KC_PORT}`,
    changeOrigin: true,
  },
  // Mailpit serves its UI under /mailpit (MP_WEBROOT=/mailpit in compose.yaml),
  // so the prefix must be preserved — do NOT rewrite/strip it.
  "/mailpit": {
    target: `http://localhost:${MAILPIT_PORT}`,
    changeOrigin: true,
  },
  // MinIO serves at root in dev (MINIO_BROWSER_REDIRECT_URL=http://localhost:9001);
  // strip the /minio prefix so MinIO receives / instead of /minio/.
  "/minio": {
    target: `http://localhost:${MINIO_PORT}`,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/minio/, ""),
  },
  // MinIO Console assets — the SPA references /static/js/... even when
  // served from a path-prefixed URL, so these must be proxied to MinIO.
  "/static": {
    target: `http://localhost:${MINIO_PORT}`,
    changeOrigin: true,
  },
  // SonarQube serves under /sonar (SONAR_WEB_CONTEXT=/sonar) — preserve the prefix.
  "/sonar": {
    target: `http://localhost:${SONAR_PORT}`,
    changeOrigin: true,
  },
  // pgAdmin serves under /pgadmin (SCRIPT_NAME=/pgadmin) — preserve the prefix.
  "/pgadmin": {
    target: `http://localhost:${PGADMIN_PORT}`,
    changeOrigin: true,
  },
  // Grafana serves under /grafana/ (GF_SERVER_ROOT_URL + GF_SERVER_SERVE_FROM_SUB_PATH).
  "/grafana": {
    target: `http://localhost:${GRAFANA_PORT}`,
    changeOrigin: true,
  },
  // Sentry serves under /sentry (SENTRY_URL_PREFIX) on the shared react-sentry stack.
  // Strip the prefix before proxying — Sentry doesn't know about /sentry internally;
  // the Vite proxy handles path-prefix transparently. Sentry auth redirects to
  // /auth/login/sentry/ (no prefix), which is handled by the /auth/login/ rule above.
  "/sentry": {
    target: `http://localhost:${SENTRY_PORT}`,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/sentry/, ""),
  },
  "/wiremock": {
    target: `http://localhost:${WIREMOCK_PORT}`,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/wiremock/, ""),
  },
  // ClickHouse serves /play at root (no path prefix in container); strip /clickhouse.
  "/clickhouse": {
    target: `http://localhost:${CH_PORT}`,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/clickhouse/, ""),
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Ensure a single React instance across all aliased packages.
    // Without dedupe, Vite may resolve react from multiple node_modules paths
    // (root vs nested), causing the React 19 production hook dispatcher to be
    // null when components from aliased platform packages call useEffect.
    dedupe: ["react", "react-dom"],
    alias: {
      "@platform/ui-design-system": path.resolve(
        __dirname,
        "../../packages/ui-design-system/src/index.ts"
      ),
      "@platform/contracts-auth": path.resolve(
        __dirname,
        "../../packages/contracts-auth/src/index.ts"
      ),
      "@platform/platform-errors": path.resolve(
        __dirname,
        "../../packages/platform-errors/src/index.ts"
      ),
      "@platform/contracts-organisation": path.resolve(
        __dirname,
        "../../packages/contracts-organisation/src/index.ts"
      ),
      "@platform/contracts-graphql": path.resolve(
        __dirname,
        "../../packages/contracts-graphql/src/index.ts"
      ),
      "@platform/graphql-browser-client": path.resolve(
        __dirname,
        "../../packages/graphql-browser-client/src/index.ts"
      ),
      "@platform/i18n-runtime": path.resolve(__dirname, "../../packages/i18n-runtime/src/index.ts"),
      "@platform/i18n-runtime/react": path.resolve(
        __dirname,
        "../../packages/i18n-runtime/src/react.ts"
      ),
      "@platform/i18n-runtime/locales/en-GB.json": path.resolve(
        __dirname,
        "../../packages/i18n-runtime/locales/en-GB.json"
      ),
    },
  },
  server: {
    // Disable HMR under Playwright to avoid rolldown builtin:vite-react-refresh-wrapper
    // "Missing field moduleType" bug in Vite 6 — causes HTTP 500 on cold dev server starts.
    hmr: !process.env["VITE_E2E"],
    proxy: bffProxy,
  },
  // preview.proxy mirrors server.proxy so `vite preview` tests the production
  // build against the real BFF. Without this, production build E2E tests would
  // not proxy API calls and would fail to prove the full stack.
  // ADR-0025 gap: E2E tests must cover the production build, not only dev mode.
  preview: {
    proxy: bffProxy,
  },
});
