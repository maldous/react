import path from "node:path";
import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
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
    },
  },
  server: {
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
