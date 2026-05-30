import path from "node:path";
import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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
    // "Missing field moduleType" bug in Vite 6 ? causes HTTP 500 on cold dev server starts.
    hmr: !process.env["VITE_E2E"],
    proxy: {
      "/api": {
        target: `http://localhost:${process.env["PLATFORM_API_PORT"] ?? 3001}`,
        changeOrigin: true,
      },
      "/healthz": {
        target: `http://localhost:${process.env["PLATFORM_API_PORT"] ?? 3001}`,
        changeOrigin: true,
      },
      "/readyz": {
        target: `http://localhost:${process.env["PLATFORM_API_PORT"] ?? 3001}`,
        changeOrigin: true,
      },
      "/version": {
        target: `http://localhost:${process.env["PLATFORM_API_PORT"] ?? 3001}`,
        changeOrigin: true,
      },
    },
  },
  // preview.proxy mirrors server.proxy so `vite preview` tests the production
  // build against the real BFF. Without this, production build E2E tests would
  // not proxy API calls and would fail to prove the full stack.
  // ADR-0025 gap: E2E tests must cover the production build, not only dev mode.
  preview: {
    proxy: {
      "/api": {
        target: `http://localhost:${process.env["PLATFORM_API_PORT"] ?? 3001}`,
        changeOrigin: true,
      },
      "/healthz": {
        target: `http://localhost:${process.env["PLATFORM_API_PORT"] ?? 3001}`,
        changeOrigin: true,
      },
      "/readyz": {
        target: `http://localhost:${process.env["PLATFORM_API_PORT"] ?? 3001}`,
        changeOrigin: true,
      },
      "/version": {
        target: `http://localhost:${process.env["PLATFORM_API_PORT"] ?? 3001}`,
        changeOrigin: true,
      },
    },
  },
});
