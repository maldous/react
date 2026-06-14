import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "**/node_modules/**",
      "reports/**",
      "docs/**",
      // Standalone NON-PRODUCTION fixture services (own package.json + tsconfig,
      // built/run in Docker). Not part of the platform lint scope (ADR-ACT-0157).
      "services/**",
      // Test fixtures contain intentionally broken/varied code
      "tools/architecture/**/tests/fixtures/**",
      // Generated GraphQL artifacts (TypedDocumentNode) — owned by graphql-codegen,
      // type-checked by tsc but not linted/formatted (ADR-ACT-0203).
      "packages/contracts-graphql/src/generated/**",
      // Canonical feature template — reference scaffolding, not compiled app code.
      "apps/react-enterprise-app/src/features/_template/**",
      // Generated READMEs
      "apps/**/README.md",
      "packages/**/README.md",
      "tools/architecture/**/README.md",
    ],
  },

  // Bucket 1: Node.js governance tooling (ESM .mjs files)
  {
    files: ["tools/architecture/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-unreachable": "error",
      "no-duplicate-imports": "error",
    },
  },

  // Bucket 2: TypeScript packages and apps
  {
    files: ["packages/**/*.ts", "packages/**/*.tsx", "apps/**/*.ts", "apps/**/*.tsx"],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-unreachable": "error",
      "no-duplicate-imports": "error",
    },
  },

  // Bucket 3: no raw console in runtime code (ADR-0020 §, ADR-ACT-0196).
  // BFF, adapters, and platform-* runtime packages must log via
  // @platform/platform-logging, never console.*. Scoped to src/ (not tests).
  // The browser logger (platform-logging/src/browser.ts) is the one allowed
  // place console output is intentional.
  {
    files: [
      "apps/platform-api/src/**/*.ts",
      "packages/adapters-*/src/**/*.ts",
      "packages/platform-*/src/**/*.ts",
    ],
    ignores: ["packages/platform-logging/src/browser.ts"],
    rules: {
      "no-console": "error",
    },
  },

  // Bucket 4: type-aware promise rules on async-critical surfaces.
  // Catches unawaited/fire-and-forget promises and async functions passed
  // where a sync callback is expected. Scoped to BFF, adapters, and
  // runtime packages only (NOT the React app). Test files excluded
  // because test frameworks use intentional fire-and-forget patterns.
  {
    files: [
      "apps/platform-api/src/**/*.ts",
      "packages/adapters-*/src/**/*.ts",
      "packages/*-runtime/src/**/*.ts",
    ],
    ignores: ["**/*.test.ts", "**/tests/**"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  }
);
