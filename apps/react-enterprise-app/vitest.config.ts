import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
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
    },
  },
  test: {
    root: path.resolve(__dirname, "../.."),
    environment: "jsdom",
    globals: true,
    setupFiles: [path.resolve(__dirname, "src/test-setup.ts")],
    include: [
      "apps/react-enterprise-app/src/**/*.test.{ts,tsx}",
      "packages/ui-design-system/tests/**/*.test.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      include: [
        "apps/react-enterprise-app/src/**/*.{ts,tsx}",
        "packages/ui-design-system/src/**/*.{ts,tsx}",
      ],
      exclude: ["apps/react-enterprise-app/src/routeTree.gen.ts", "**/*.d.ts"],
    },
  },
});
