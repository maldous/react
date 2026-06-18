// Pure-unit test env preload (node --test --import), ADR-ACT-0290.
//
// Pure unit + architecture suites must be HERMETIC: they must not read the
// developer's generated .env/<stage>.env or .env/secrets (so a result never
// varies with whatever stage env happens to be on disk, and so they run with no
// generated env files at all). This preload reads NO files. It sets a small set
// of FIXED, obviously-fake, test-local values — only for keys that are still
// undefined — so any unit that incidentally reads them gets a deterministic,
// non-secret value instead of crashing on a "must be set" guard.
//
// It never overrides an explicit process.env value, so `KEY=… npm run test:*`
// stays authoritative. These are NOT real credentials and never touch a real
// service: a genuinely infra-dependent test belongs in test:platform-api
// (which loads the managed env via preload-env.mjs), not here.
//
// Contrast: preload-env.mjs loads the managed runtime env for integration /
// runtime-proof suites that genuinely need real service credentials.

export const FIXED_TEST_ENV = {
  // Parseable but non-routable — pure units never open a real connection; if one
  // tries, it fails fast rather than reaching a developer's database.
  POSTGRES_URL: "postgresql://unit_test:unit_test@127.0.0.1:1/platform_unit_test",
  POSTGRES_APP_URL: "postgresql://unit_test_app:unit_test_app@127.0.0.1:1/platform_unit_test",
  // Deterministic 32-byte (64 hex) key so token-crypto code paths are exercisable
  // without a secret. Clearly fake (all 'a').
  TENANT_SECRET_ENCRYPTION_KEY: "a".repeat(64),
  PLATFORM_ENV: "test",
  NODE_ENV: "test",
};

// Apply the fixed fakes to `env`, never overriding a value that is already set
// (so an explicit `KEY=… npm run test:*` stays authoritative). Pure + exported so
// the contract is unit-testable without a side-effecting dynamic import.
export function applyUnitEnv(env = process.env) {
  for (const [key, value] of Object.entries(FIXED_TEST_ENV)) {
    if (env[key] === undefined) env[key] = value;
  }
  return env;
}

// Side effect for `node --test --import`.
applyUnitEnv();
