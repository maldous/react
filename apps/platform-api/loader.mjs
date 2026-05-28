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
