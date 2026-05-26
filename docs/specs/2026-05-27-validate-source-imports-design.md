# Design: validate-source-imports tool (ADR-ACT-0007)

**Date:** 2026-05-27  
**Status:** Approved  
**Closes:** ADR-ACT-0007 (source-code import-boundary enforcement)  
**Depends on:** ADR-0001, ADR-0002, ADR-0003, ADR-ACT-0013, ADR-ACT-0014

---

## Purpose

Implement source-code import-boundary scanning for the enterprise React platform monorepo. Validates that TypeScript/JS source files in `apps/` and `packages/` only import from permitted packages, with no deep imports, no test-support in production files, and no cross-layer violations per `docs/architecture/import-boundary-rules.md`.

This closes the remaining "future enforcement work" noted in ADR-ACT-0007 and the enforcement status note at the bottom of `docs/architecture/import-boundary-rules.md`.

---

## Scope

**In scope:**
- New standalone governance tool `tools/architecture/validate-source-imports`
- Regex-based import extraction from `.ts`, `.tsx`, `.js`, `.mjs` source files
- Enforcement of all rules in the initial allowed dependency matrix
- Deep-import prohibition (no `@platform/x/src/...` or relative cross-package paths)
- Test-support-in-production prohibition
- Per-package forbidden import rules derived from `import-boundary-rules.md`
- Fixture source files (valid and invalid) for each enforced rule
- Committed governance evidence at `docs/evidence/import-boundaries/source-import-boundary-validation.{json,md}`
- Orchestrator integration (inserted after `validate-package-metadata` in `all` plan)
- ADR-ACT-0007 and ADR-ACT-0031 status updates in ACTION-REGISTER

**Out of scope:**
- TypeScript type-checking or compiler integration
- Circular dependency analysis
- Runtime resolution or `node_modules` scanning
- Relative within-package import validation
- Dynamic import path fragments (runtime-computed strings)

---

## Architecture

### Tool location

```
tools/architecture/validate-source-imports/
  package.json
  src/
    index.mjs
    rules.mjs
    scanner.mjs
    reporter.mjs
  tests/
    validate-source-imports.test.mjs
    fixtures/
      valid/
        ...
      invalid/
        ...
```

### Module responsibilities

| Module | Responsibility |
|---|---|
| `index.mjs` | CLI entry, arg parsing, orchestration of scan → validate → report cycle, ADR-0011 contract |
| `rules.mjs` | Encodes the full boundary rule matrix from `import-boundary-rules.md` |
| `scanner.mjs` | File walker + regex import extractor, package identification by nearest `package.json` |
| `reporter.mjs` | JSON/Markdown report construction, self-evidence emission |

---

## CLI contract (ADR-0011)

```bash
node tools/architecture/validate-source-imports/src/index.mjs \
  [--root <path>] \
  [--format text|json] \
  [--no-reports] \
  [--check | --write] \
  [apps] [packages] [...]
```

| Flag | Behaviour |
|---|---|
| `--root <path>` | Repository root. Defaults to cwd or nearest ancestor with `docs/schemas/package-json-architecture.schema.json`. |
| `--format text\|json` | Console output format. Default: `text`. |
| `--no-reports` | Skip writing report files. Self-evidence is also suppressed. |
| `--check` | Validate without writing committed evidence (default). |
| `--write` | Write committed governance evidence to `docs/evidence/import-boundaries/source-import-boundary-validation.*`. Consistent with `--write` semantics in other governance tools where the flag produces committed output (cf. `validate-lifecycle-evidence --write`). |
| positional args | Directories to scan, relative to `--root`. Defaults to `apps packages`. |

**Exit codes:** `0` = all files pass. `1` = any violation found or unrecoverable error.

---

## Rule encoding (`rules.mjs`)

Rules are expressed as a plain object keyed by package name (or `"*"` for universal rules). Each entry has:

- `forbiddenPrefixes`: array of import-specifier prefixes that must not appear in source files belonging to this package
- `forbiddenExact`: array of exact import specifiers that must not appear

Universal rules (applied to every package):

| Rule ID | Description |
|---|---|
| `no-deep-import` | No `@platform/<x>/<anything>` — only bare package import allowed |
| `no-test-support-in-prod` | Non-test source files must not import `@platform/test-support` |

Per-package rules (subset shown; full set in `rules.mjs`):

| Package | Forbidden imports |
|---|---|
| `@platform/domain-core` | `react`, `react-dom`, `graphql`, `@apollo/`, `@graphql-codegen/`, `@platform/adapters-`, `@platform/react-enterprise-app`, `@platform/feature-workflow` |
| `@platform/ui-design-system` | `@platform/adapters-`, `@platform/contracts-`, `@platform/domain-core`, `@platform/profile-configuration`, `@platform/access-control` |
| `@platform/profile-configuration` | `@platform/adapters-postgres`, `@platform/adapters-clickhouse`, `@platform/adapters-graphql`, `react`, `react-dom` |
| `@platform/access-control` | `@platform/adapters-postgres`, `@platform/adapters-clickhouse`, `react`, `react-dom` |
| `@platform/contracts-graphql` | `@platform/adapters-graphql` |
| `@platform/contracts-ingestion` | `@platform/adapters-ingestion`, `@platform/adapters-postgres`, `@platform/adapters-clickhouse` |
| `@platform/contracts-analytics` | `@platform/adapters-clickhouse` |
| `@platform/feature-workflow` | `@platform/adapters-postgres`, `@platform/adapters-clickhouse` |

---

## Import extraction (`scanner.mjs`)

### Regex patterns

Three patterns, applied per line to all non-comment source lines:

```text
static import:   import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]
re-export:       export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]
dynamic import:  import\s*\(\s*['"]([^'"]+)['"]\s*\)
```

Dynamic imports with runtime-computed paths (template literals, variables) are not matched and are therefore not checked — this is acceptable for a governance tool targeting static structure.

### Package identification

Walk up the directory tree from a source file until a `package.json` with a `name` field is found. That `name` is the owning package. Files not under any named package are skipped.

### Test-file detection

A source file is classified as a test file if its resolved path satisfies any of:

```text
/tests/ segment in path
/test/ segment in path
filename ends with .test.ts, .test.tsx, .test.js, .spec.ts, .spec.tsx, .spec.js
```

Test files are excluded from the `no-test-support-in-prod` rule only. All other rules still apply to test files (e.g., deep imports are still forbidden in test fixtures).

### File extensions scanned

`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs` — excludes `.d.ts` declaration files.

### Directories skipped

`node_modules`, `dist`, `build`, `.git`, `coverage` — same ignored-set pattern as `validate-package-metadata`.

---

## Output

### Reports (gitignored)

```
reports/validation/source-import-validation.json
reports/validation/source-import-validation.md
```

JSON structure:
```json
{
  "generatedAt": "<ISO>",
  "totalFiles": 42,
  "totalImports": 130,
  "passed": 40,
  "failed": 2,
  "violations": [
    {
      "file": "packages/domain-core/src/index.ts",
      "package": "@platform/domain-core",
      "specifier": "react",
      "rule": "no-react-in-domain",
      "message": "@platform/domain-core must not import react"
    }
  ]
}
```

### Self-evidence (gitignored, under reports/tooling/)

`reports/tooling/validate-source-imports/<ISO-timestamp>-run.json`

Required fields: `toolName`, `toolVersion`, `command`, `mode`, `root`, `startedAt`, `finishedAt`, `durationMs`, `inputRoots`, `outputPaths`, `rulesEvaluated`, `checksPassed`, `checksFailed`, `violations`, `exitCode`.

### Committed governance evidence

Written with `--write`:

```
docs/evidence/import-boundaries/source-import-boundary-validation.json
docs/evidence/import-boundaries/source-import-boundary-validation.md
```

The JSON structure mirrors the report but adds `ruleSet`, `scanMethod`, and `toolVersion` fields for auditability. The Markdown is a human-readable summary.

---

## Test fixtures

### Valid fixtures

Each valid fixture is a directory containing a `package.json` (minimal: `name`, `architecture.lifecycle.role`) and one or more `.ts` source files with imports that satisfy all boundary rules for that package.

| Fixture | What it validates |
|---|---|
| `valid/domain-core/` | domain-core with zero imports — passes all rules |
| `valid/feature-workflow/` | feature-workflow importing `@platform/ui-design-system` and `@platform/domain-core` — permitted |
| `valid/access-control/` | access-control importing `@platform/domain-core` and `@platform/profile-configuration` — permitted |
| `valid/contracts-graphql/` | contracts-graphql with no adapter imports — permitted |

### Invalid fixtures

One fixture per rule being enforced. Each is a single-package directory with a source file containing the offending import.

| Fixture | Rule violated |
|---|---|
| `invalid/deep-import/` | `no-deep-import`: imports `@platform/domain-core/src/internal` |
| `invalid/test-support-in-prod/` | `no-test-support-in-prod`: production file imports `@platform/test-support` |
| `invalid/domain-imports-react/` | domain-core imports `react` |
| `invalid/domain-imports-graphql/` | domain-core imports `graphql` |
| `invalid/domain-imports-adapter/` | domain-core imports `@platform/adapters-postgres` |
| `invalid/feature-imports-postgres/` | feature-workflow imports `@platform/adapters-postgres` |
| `invalid/feature-imports-clickhouse/` | feature-workflow imports `@platform/adapters-clickhouse` |
| `invalid/contract-imports-adapter/` | `@platform/contracts-graphql` imports `@platform/adapters-graphql` |
| `invalid/contracts-ingestion-imports-adapter/` | `@platform/contracts-ingestion` imports `@platform/adapters-ingestion` |
| `invalid/contracts-analytics-imports-adapter/` | `@platform/contracts-analytics` imports `@platform/adapters-clickhouse` |
| `invalid/ui-imports-domain/` | ui-design-system imports `@platform/domain-core` |
| `invalid/access-imports-react/` | access-control imports `react` |
| `invalid/profile-imports-postgres/` | profile-configuration imports `@platform/adapters-postgres` |

---

## Orchestrator integration

The orchestrator's `all` command plan is updated to include `validate-source-imports` after `validate-package-metadata`:

```
validate-package-metadata
  → validate-source-imports    ← new, required
  → generate-package-readmes   (--check, optional)
  → generate-package-inventory (--check, optional)
  → generate-lifecycle-reports (--check, optional)
  → validate-lifecycle-evidence
```

The `validate` command (metadata only) remains unchanged — source scanning requires explicit `all` or direct invocation.

Orchestrator `package.json` `dependsOn` is updated to include `@architecture/validate-source-imports`.

---

## Action register updates

| Action | From | To |
|---|---|---|
| ADR-ACT-0007 | In Progress | Done |
| ADR-ACT-0031 | Open | Done (test-support production check closes this) |

Evidence column for ADR-ACT-0007: `Source import boundary scanning implemented in tools/architecture/validate-source-imports; evidence at docs/evidence/import-boundaries/source-import-boundary-validation.*`

---

## Error handling

- Source files that cannot be read (permissions, encoding) produce a warning, not a hard failure, unless `--strict` is passed.
- Packages whose `package.json` cannot be read: source files under them are skipped with a warning.
- Violations are reported with: file path (relative to repo root), owning package name, offending specifier, rule ID, human-readable message.
- `--format json` output always exits before any process.exit call so the JSON is well-formed on failure.

---

## Non-goals and constraints

- Do not parse TypeScript types — specifiers only
- Do not validate third-party dependency boundaries beyond universal rules: non-`@platform/*` specifiers are checked only for universal rules (`no-deep-import`, `no-test-support-in-prod`); no attempt is made to enforce allowed/forbidden third-party packages at the per-package level
- Do not add any runtime dependencies — regex only, zero `node_modules`
- Do not alter `validate-package-metadata` — it remains metadata-only
- Do not generate a new ADR — all rules derive from existing accepted ADRs
