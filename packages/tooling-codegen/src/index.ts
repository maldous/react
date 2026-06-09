// Public entry point for @platform/tooling-codegen.
export const packageName = "@platform/tooling-codegen";

// ---------------------------------------------------------------------------
// GraphQL Code Generator contract (ADR-0013, ADR-0028, ADR-ACT-0203).
//
// This package OWNS the codegen configuration: the canonical artifact path, the
// operation document glob, and the browser-safe plugin set. The runnable entry
// is the repo-root `codegen.ts`, which injects the single canonical schema
// source (BASE_SCHEMA_SDL from @platform/contracts-graphql) into this contract.
// Keeping the schema injection at the repo root keeps this package free of a
// cross-package source import while still owning the generation policy.
// ---------------------------------------------------------------------------

/** Committed generated GraphQL artifact (repo-root relative). */
export const GENERATED_GRAPHQL_FILE = "packages/contracts-graphql/src/generated/graphql.ts";

/** Glob for the canonical GraphQL operation documents. */
export const GRAPHQL_OPERATIONS_GLOB = "packages/contracts-graphql/src/operations/**/*.graphql";

/**
 * Plugin set for browser-safe TypedDocumentNode output — NO React hooks, NO
 * client. The typed-document-node plugin inlines the operation AST and imports
 * only the type-only @graphql-typed-document-node/core.
 */
export const CODEGEN_PLUGINS = ["typescript", "typescript-operations", "typed-document-node"];

/** Plugin config keeping output deterministic and isolatedModules-safe. */
export const CODEGEN_CONFIG = {
  useTypeImports: true,
  documentMode: "documentNode",
  enumsAsTypes: true,
  skipTypename: false,
  scalars: { ID: "string" },
  defaultScalarType: "unknown",
};
