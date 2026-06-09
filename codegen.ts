import type { CodegenConfig } from "@graphql-codegen/cli";
import { BASE_SCHEMA_SDL } from "./packages/contracts-graphql/src/index.ts";
import {
  GENERATED_GRAPHQL_FILE,
  GRAPHQL_OPERATIONS_GLOB,
  CODEGEN_PLUGINS,
  CODEGEN_CONFIG,
} from "./packages/tooling-codegen/src/index.ts";

// ---------------------------------------------------------------------------
// GraphQL Code Generator — governed platform subsystem (ADR-0013, ADR-0028,
// ADR-ACT-0203). Thin repo-root entry: it injects the single canonical schema
// source (BASE_SCHEMA_SDL) into the generation contract owned by
// @platform/tooling-codegen. Output is browser-safe TypedDocumentNode artifacts
// consumed by feature hooks through @platform/graphql-browser-client.
//
//   npm run codegen        # regenerate
//   npm run codegen:check  # regenerate and fail on drift (CI / make check)
// ---------------------------------------------------------------------------

const config: CodegenConfig = {
  schema: BASE_SCHEMA_SDL,
  documents: [GRAPHQL_OPERATIONS_GLOB],
  ignoreNoDocuments: false,
  generates: {
    [GENERATED_GRAPHQL_FILE]: {
      plugins: [...CODEGEN_PLUGINS],
      config: CODEGEN_CONFIG,
    },
  },
};

export default config;
