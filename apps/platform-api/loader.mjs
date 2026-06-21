/**
 * Node.js module loader for platform-api tests.
 * Maps @platform/* package specifiers to their source files so node:test
 * can resolve them without tsconfig path aliases.
 *
 * Usage: node --loader apps/platform-api/loader.mjs --test <files>
 *
 * This loader intercepts @platform/* imports and redirects them to the
 * actual package source files using relative paths from the repo root.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolvePath(__dirname, "../..");

const PLATFORM_MAP = {
  "@platform/api-runtime": resolvePath(repoRoot, "packages/api-runtime/src/index.ts"),
  "@platform/platform-logging": resolvePath(repoRoot, "packages/platform-logging/src/index.ts"),
  "@platform/platform-observability": resolvePath(
    repoRoot,
    "packages/platform-observability/src/index.ts"
  ),
  "@platform/platform-runtime-context": resolvePath(
    repoRoot,
    "packages/platform-runtime-context/src/index.ts"
  ),
  "@platform/platform-errors": resolvePath(repoRoot, "packages/platform-errors/src/index.ts"),
  "@platform/contracts-auth": resolvePath(repoRoot, "packages/contracts-auth/src/index.ts"),
  "@platform/domain-identity": resolvePath(repoRoot, "packages/domain-identity/src/index.ts"),
  "@platform/session-runtime": resolvePath(repoRoot, "packages/session-runtime/src/index.ts"),
  "@platform/adapters-keycloak": resolvePath(repoRoot, "packages/adapters-keycloak/src/index.ts"),
  "@platform/adapters-redis": resolvePath(repoRoot, "packages/adapters-redis/src/index.ts"),
  "@platform/adapters-postgres": resolvePath(repoRoot, "packages/adapters-postgres/src/index.ts"),
  "@platform/adapters-brevo": resolvePath(repoRoot, "packages/adapters-brevo/src/index.ts"),
  "@platform/adapters-clickhouse": resolvePath(
    repoRoot,
    "packages/adapters-clickhouse/src/index.ts"
  ),
  "@platform/adapters-graphql": resolvePath(repoRoot, "packages/adapters-graphql/src/index.ts"),
  "@platform/adapters-loki": resolvePath(repoRoot, "packages/adapters-loki/src/index.ts"),
  "@platform/adapters-ingestion": resolvePath(repoRoot, "packages/adapters-ingestion/src/index.ts"),
  "@platform/adapters-object-storage": resolvePath(
    repoRoot,
    "packages/adapters-object-storage/src/index.ts"
  ),
  "@platform/adapters-opentelemetry": resolvePath(
    repoRoot,
    "packages/adapters-opentelemetry/src/index.ts"
  ),
  "@platform/adapters-sentry": resolvePath(repoRoot, "packages/adapters-sentry/src/index.ts"),
  "@platform/domain-core": resolvePath(repoRoot, "packages/domain-core/src/index.ts"),
  "@platform/config-runtime": resolvePath(repoRoot, "packages/config-runtime/src/index.ts"),
  "@platform/email-runtime": resolvePath(repoRoot, "packages/email-runtime/src/index.ts"),
  "@platform/storage-runtime": resolvePath(repoRoot, "packages/storage-runtime/src/index.ts"),
  "@platform/audit-events": resolvePath(repoRoot, "packages/audit-events/src/index.ts"),
  "@platform/profile-configuration": resolvePath(
    repoRoot,
    "packages/profile-configuration/src/index.ts"
  ),
  "@platform/feature-workflow": resolvePath(repoRoot, "packages/feature-workflow/src/index.ts"),
  "@platform/contracts-analytics": resolvePath(
    repoRoot,
    "packages/contracts-analytics/src/index.ts"
  ),
  "@platform/contracts-graphql": resolvePath(repoRoot, "packages/contracts-graphql/src/index.ts"),
  "@platform/contracts-ingestion": resolvePath(
    repoRoot,
    "packages/contracts-ingestion/src/index.ts"
  ),
  "@platform/graphql-api-runtime": resolvePath(
    repoRoot,
    "packages/graphql-api-runtime/src/index.ts"
  ),
  "@platform/contracts-organisation": resolvePath(
    repoRoot,
    "packages/contracts-organisation/src/index.ts"
  ),
  "@platform/contracts-admin": resolvePath(repoRoot, "packages/contracts-admin/src/index.ts"),
  "@platform/i18n-runtime": resolvePath(repoRoot, "packages/i18n-runtime/src/index.ts"),
  "@platform/authorisation-runtime": resolvePath(
    repoRoot,
    "packages/authorisation-runtime/src/index.ts"
  ),
};

export function resolve(specifier, context, nextResolve) {
  const mapped = PLATFORM_MAP[specifier];
  if (mapped) {
    return {
      shortCircuit: true,
      url: pathToFileURL(mapped).href,
    };
  }
  return nextResolve(specifier, context);
}
