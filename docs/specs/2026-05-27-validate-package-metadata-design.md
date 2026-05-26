# Design: validate-package-metadata tool

**Date:** 2026-05-27  
**Status:** As-built  
**Implements:** ADR-ACT-0034, ADR-ACT-0048, ADR-ACT-0066, ADR-ACT-0073  
**Governed by:** ADR-0005, ADR-0006, ADR-0007, ADR-0011, ADR-0012

---

## Purpose

Validates that every `package.json` in `apps/`, `packages/`, and `tools/architecture/` conforms to the governed architecture metadata schema and cross-field semantic rules. This is the foundation check that all other governance tools depend on — it must pass before any downstream tool is meaningful.

---

## Location

```
tools/architecture/validate-package-metadata/
  package.json     # @architecture/validate-package-metadata
  src/index.mjs
  tests/
    validate-package-metadata.test.mjs
    fixtures/
      valid/schema-valid/package.json
      invalid/missing-architecture/package.json
      invalid/invalid-enum/package.json
      invalid/semantic-lifecycle-class/package.json
```

---

## CLI contract (ADR-0011)

```bash
node tools/architecture/validate-package-metadata/src/index.mjs \
  [--root <path>] [--format text|json] [--no-reports] \
  [--strict] [--allow-missing-ajv] [--check] [--write] \
  [apps] [packages] [tools/architecture] [...]
```

| Flag | Behaviour |
|---|---|
| `--root <path>` | Repository root. Default: nearest ancestor with `docs/schemas/package-json-architecture.schema.json`. |
| `--format text\|json` | Console output format. Default: `text`. |
| `--no-reports` | Skip writing `reports/validation/` and self-evidence. |
| `--allow-missing-ajv` | Treat missing Ajv as a warning instead of a hard error. Used in environments without installed dependencies. |
| `--strict` | Reserved; currently a no-op pass-through. |
| `--check` / `--write` | Accepted and ignored — this tool is always read-only. |
| positional args | Directories to scan relative to `--root`. Default: `apps packages tools/architecture`. |

**Exit codes:** `0` = all packages valid. `1` = any package invalid or unrecoverable error.

---

## Validation layers

### Layer 1 — JSON Schema (Ajv)

Validates the full `package.json` structure against `docs/schemas/package-json-architecture.schema.json`. Requires Ajv `^8.17.1` declared as a dependency. Falls back gracefully when Ajv is absent if `--allow-missing-ajv` is set.

### Layer 2 — Required field presence

Checks that `name`, `version`, `description`, `private`, `type`, `exports`, and `architecture` are all present.

### Layer 3 — Architecture group presence

Checks that `architecture` contains all required groups: `schemaVersion`, `component`, `lifecycle`, `governance`, `runtime`, `boundaries`, `relations`, `tags`, `readme`.

### Layer 4 — Semantic cross-field rules

Rules not expressible in JSON Schema alone:

| Rule | Constraint |
|---|---|
| `lifecycle.class` | Must equal `${stage}.${role}` |
| `lifecycle.catalogLifecycle` | Must be `experimental` for experimental/candidate, `deprecated` for deprecated, `production` otherwise |
| `lifecycle.stage === "external"` | `visibility` must be `"external"` |
| `lifecycle.stage === "deprecated"` | `visibility` must be `"deprecated"`, `supportLevel` must be `"deprecated"` or `"unsupported"` |
| `runtime.production` + `runtime.testOnly` | Cannot both be `true` |
| `boundaries.publicExportsOnly` + `boundaries.deepImportsAllowed` | Cannot both be `true` |
| `governance.decisionRefs` | Each entry must match `/^ADR-\d{4}$/` |

---

## Output

### Reports (gitignored)

```
reports/validation/package-metadata-validation.json
reports/validation/package-metadata-validation.md
```

### Self-evidence (gitignored)

`reports/tooling/validate-package-metadata/<ISO-timestamp>-run.json`

Required fields: `toolName`, `toolVersion`, `command`, `mode`, `root`, `startedAt`, `finishedAt`, `durationMs`, `inputRoots`, `outputPaths`, `rulesEvaluated`, `checksPassed`, `checksFailed`, `warnings`, `errors`, `schemaValidator`, `exitCode`.

---

## File discovery

Walks each scan root recursively. Skips `node_modules`, `.git`, `dist`, `build`, `coverage`, `reports`. Skips `tests/fixtures/` sub-trees unless the scan root itself is inside a fixture directory (enabling direct fixture invocation in tests).

Collects all files named `package.json`, deduplicates, sorts.

---

## Test strategy (ADR-0012)

Tests use `spawnSync` against the tool script with `--root`, `--allow-missing-ajv`, `--no-reports`, `--format json`. Each test asserts `result.status` and parses JSON output.

| Test case | Assertion |
|---|---|
| `fixtures/valid/schema-valid/` | Exit 0, `failed === 0` |
| `fixtures/invalid/missing-architecture/` | Exit 1, `failed === 1` |
| `fixtures/invalid/invalid-enum/` | Exit 1, `failed === 1` |
| `fixtures/invalid/semantic-lifecycle-class/` | Exit 1, `failed === 1` |
| `--no-reports` flag | `selfEvidencePath === null` in JSON output |
| Without `--allow-missing-ajv` when Ajv absent | Exit 1 if Ajv unavailable |
| Text output mode | Stdout matches expected patterns |
| Reports written | Report files exist on disk after non-`--no-reports` run |
