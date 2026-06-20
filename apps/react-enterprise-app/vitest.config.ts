import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Ensure a single React instance across the app, ui-design-system, and
    // react-aria-components — otherwise components mounting React Aria primitives
    // resolve a second copy and hit a null hooks dispatcher under jsdom.
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
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
      "@platform/contracts-admin": path.resolve(
        __dirname,
        "../../packages/contracts-admin/src/index.ts"
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
  test: {
    root: path.resolve(__dirname, "../.."),
    environment: "jsdom",
    globals: true,
    setupFiles: [path.resolve(__dirname, "src/test-setup.ts")],
    include: [
      "apps/react-enterprise-app/src/**/*.test.{ts,tsx}",
      "packages/ui-design-system/tests/**/*.test.{ts,tsx}",
      "packages/graphql-browser-client/tests/**/*.test.{ts,tsx}",
      "packages/i18n-runtime/tests/react.test.tsx",
    ],
    // Canonical feature template is reference scaffolding — never executed.
    exclude: [...configDefaults.exclude, "**/features/_template/**"],
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
