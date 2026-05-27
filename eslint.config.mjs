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
      // Test fixtures contain intentionally broken/varied code
      "tools/architecture/**/tests/fixtures/**",
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
  }
);
