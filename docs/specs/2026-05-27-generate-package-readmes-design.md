# Design: generate-package-readmes tool

**Date:** 2026-05-27  
**Status:** As-built  
**Implements:** ADR-ACT-0054, ADR-ACT-0055, ADR-ACT-0056, ADR-ACT-0074  
**Governed by:** ADR-0005, ADR-0007, ADR-0008, ADR-0011, ADR-0012

---

## Purpose

Generates or validates `README.md` files for every package in `apps/`, `packages/`, and `tools/architecture/` from the `architecture.readme` block in each `package.json`. Keeps human-readable package documentation derived from the machine-readable metadata single source of truth, with a defined extension point for manual notes.

---

## Location

```
tools/architecture/generate-package-readmes/
  package.json     # @architecture/generate-package-readmes
  src/index.mjs
  tests/
    generate-package-readmes.test.mjs
    fixtures/
      valid/app/package.json
      representative/valid/{domain,feature,ui,react-app,tooling,test,graphql-contract,graphql-adapter}/package.json
      representative/golden/{domain,feature,ui,react-app,tooling,test,graphql-contract,graphql-adapter}/README.md
      golden/app/README.md
```

---

## CLI contract (ADR-0011)

```bash
node tools/architecture/generate-package-readmes/src/index.mjs \
  [--root <path>] [--format text|json] [--no-reports] \
  [--check | --write] [--package <name>] \
  [apps] [packages] [tools/architecture] [...]
```

| Flag | Behaviour |
|---|---|
| `--root <path>` | Repository root. |
| `--format text\|json` | Console output format. Default: `text`. |
| `--no-reports` | Skip self-evidence output. |
| `--check` | Validate existing READMEs against expected output without writing. Exit 1 if any are stale or missing. Default. |
| `--write` | Write or update package-local `README.md` files. Preserves manual extension content. |
| `--package <name>` | Limit to one package by npm name. |
| positional args | Scan roots. Default: `apps packages tools/architecture`. |

**Exit codes:** `0` = all READMEs fresh (check) or all writes succeeded. `1` = any README stale/missing (check mode).

---

## README generation

### Template structure (ADR-0008)

Every generated README contains these sections in order:

1. Generated notice comment
2. Package name heading + summary
3. Package identity block
4. Lifecycle block
5. Ownership block
6. Responsibilities list
7. Non-responsibilities list
8. Public exports and usage block
9. Boundaries (allowed + forbidden consumers)
10. Runtime and environments block
11. Relations (depends on, provides APIs, consumes APIs)
12. Operational notes
13. Governance (decision refs)
14. Validation (standard command)
15. Extension notes with `<!-- BEGIN MANUAL EXTENSION -->` / `<!-- END MANUAL EXTENSION -->` markers

### Skipping packages

A package is skipped (not an error) if `architecture.readme.generated !== true`.

### Staleness check (--check mode)

Compares expected rendered output against existing file content after stripping the manual extension block from both sides. A file is `fresh` if the generated section content matches exactly. Reports `stale` if missing or different.

### Manual extension preservation (--write mode)

Content between `<!-- BEGIN MANUAL EXTENSION -->` and `<!-- END MANUAL EXTENSION -->` in the current file is preserved unchanged during writes. Only the generated sections are updated.

### Manual edit detection

In `--check` mode, edits outside the extension markers cause a `stale` result with an explicit error: `"README contains manual edits outside approved extension markers"`.

---

## Output

### Package-local README files

Written at `<package-dir>/README.md` — committed source artifacts, not in `reports/`.

### Self-evidence (gitignored)

`reports/tooling/generate-package-readmes/<ISO-timestamp>-run.json`

Required fields match ADR-0011 self-evidence contract. `mode` is `"check"` or `"write"`. `outputPaths` lists only files actually written (write mode) or empty (check mode).

---

## Structure validation

After rendering, the expected output is validated to contain all required headings and both extension markers in correct order. This catches template regressions before they reach disk.

Required headings: `# `, `## Package identity`, `## Lifecycle`, `## Ownership`, `## Responsibilities`, `## Non-responsibilities`, `## Public exports and usage`, `## Boundaries`, `## Runtime and environments`, `## Relations`, `## Operational notes`, `## Governance`, `## Validation`, `## Extension notes`.

---

## Test strategy (ADR-0012)

### Golden-output tests

Render each representative fixture package and compare byte-for-byte against committed golden README files. Representative fixtures cover: React app, feature, UI, domain, GraphQL contract, GraphQL adapter, tooling, test.

### Staleness tests

Run tool in `--check` mode against fixtures with known-stale or missing READMEs; assert exit 1.

### Write tests

Run tool in `--write` mode; assert READMEs are written; re-run in `--check` mode and assert exit 0.

### Manual extension preservation test

Write a README with custom content in the extension block; run `--write`; assert extension content survives.

### Manual edit detection test

Write a README with edits outside extension markers; run `--check`; assert exit 1 with the expected error message.
