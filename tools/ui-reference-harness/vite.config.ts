import path from "node:path";
import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Non-shipping semantic reference harness. Resolves the shared design system the same way the
// product app does (alias → packages/*/src) so rendered semantics match the real components.
// Deliberately no Tailwind: journeys assert roles/names/state, not visual styling.
const repoRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@platform/ui-design-system": path.resolve(
        repoRoot,
        "packages/ui-design-system/src/index.ts"
      ),
    },
  },
  server: {
    port: Number(process.env["HARNESS_PORT"] ?? 5180),
    // Allow importing the capability model from the repo's docs/ tree (outside this app root).
    fs: { allow: [repoRoot] },
  },
});
