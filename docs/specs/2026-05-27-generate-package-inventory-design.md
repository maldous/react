# Design: generate-package-inventory tool

**Date:** 2026-05-27  
**Status:** As-built  
**Implements:** ADR-ACT-0044, ADR-ACT-0058, ADR-ACT-0059  
**Governed by:** ADR-0005, ADR-0006, ADR-0007, ADR-0009, ADR-0011, ADR-0012

---

## Purpose

Generates a machine-readable package inventory and a human-readable lifecycle summary from `package.json` architecture metadata across all packages in the monorepo. Provides a single queryable snapshot of the full package graph: names, types, domains, bounded contexts, lifecycle classes, owners, and dependency declarations.

---

## Location

```text
tools/architecture/generate-package-inventory/
  package.json     # @architecture/generate-package-inventory
  src/index.mjs
  tests/
    generate-package-inventory.test.mjs
    fixtures/
      valid/docs/schemas/package-json-architecture.schema.json
      valid/packages/{adapter,app,contract,domain,feature,test,tooling,ui}/package.json
      golden/reports/package-inventory/package-inventory.{json,md}
      golden/reports/lifecycle/package-lifecycle-summary.{json,md}
```

---

## CLI contract (ADR-0011)

```bash
node tools/architecture/generate-package-inventory/src/index.mjs \
  [--root <path>] [--format text|json] [--no-reports] \
  [--check | --write] \
  [apps] [packages] [tools/architecture] [...]
```

| Flag                  | Behaviour                                                                              |
| --------------------- | -------------------------------------------------------------------------------------- |
| `--root <path>`       | Repository root.                                                                       |
| `--format text\|json` | Console output format. Default: `text`.                                                |
| `--no-reports`        | Skip report writing and self-evidence.                                                 |
| `--check`             | Compare expected output against existing reports. Exit 1 if stale or missing. Default. |
| `--write`             | Generate and write all four report files.                                              |
| positional args       | Scan roots. Default: `apps packages tools/architecture`.                               |

**Exit codes:** `0` = all reports fresh (check) or all written successfully. `1` = any report stale/missing in check mode.

**Environment variable:** `ARCHITECTURE_REPORT_GENERATED_AT` ? if set, overrides the `generatedAt` timestamp in all outputs. Used in tests for deterministic golden-file comparison.

---

## Output files

All four outputs are gitignored under `reports/**`:

| File                                               | Description                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `reports/package-inventory/package-inventory.json` | Full package record array with all architecture metadata fields                   |
| `reports/package-inventory/package-inventory.md`   | Markdown table: Package, Type, Domain, Context, Lifecycle, Owner, Path            |
| `reports/lifecycle/package-lifecycle-summary.json` | Aggregate counts by stage/role/class/supportLevel plus per-package lifecycle rows |
| `reports/lifecycle/package-lifecycle-summary.md`   | Markdown tables for by-stage, by-role, by-class breakdowns plus full package list |

### Package record structure (JSON inventory)

```json
{
  "name": "@platform/domain-core",
  "version": "0.1.0",
  "path": "packages/domain-core/package.json",
  "component": { "name", "type", "system", "domain", "boundedContext", "owner" },
  "lifecycle": { "stage", "role", "class", "catalogLifecycle", "visibility", "supportLevel", "reviewCadence" },
  "governance": { "decisionRefs", "semverPolicy", "changeControl", "promotionEligible" },
  "runtime": { "production", "testOnly", "serviceName", "serviceNamespace", "deploymentEnvironments" },
  "relations": { "dependsOn", "providesApis", "consumesApis" },
  "tags": { ... }
}
```

Packages without an `architecture` block are silently skipped (not an error).

---

## Staleness check (--check mode)

Renders all four outputs in memory and compares byte-for-byte to existing files on disk. A file is `fresh` if content matches. Any difference or missing file is `stale`. The tool preserves the `generatedAt` timestamp from the existing inventory JSON when in check mode to avoid spurious timestamp-only diffs.

---

## Self-evidence (gitignored)

`reports/tooling/generate-package-inventory/<ISO-timestamp>-run.json`

`rulesEvaluated` lists: package inventory JSON output, package inventory Markdown output, lifecycle summary JSON output, lifecycle summary Markdown output, check/write mode behaviour.

---

## Test strategy (ADR-0012)

### Golden-output tests

Run the tool against `fixtures/valid/` with `ARCHITECTURE_REPORT_GENERATED_AT` set to a fixed timestamp. Compare output byte-for-byte against committed golden files. Fixture covers app, feature, UI, domain, contract, adapter, tooling, and test package types.

### Staleness detection test

Delete or corrupt a golden report; run `--check`; assert exit 1.

### Write test

Run `--write`; assert exit 0; assert all four report files exist with correct content.

### Self-evidence suppression test

Run with `--no-reports`; assert no files written; assert `selfEvidencePath === null` in JSON output.
