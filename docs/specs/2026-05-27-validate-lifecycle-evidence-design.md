# Design: validate-lifecycle-evidence tool

**Date:** 2026-05-27  
**Status:** As-built  
**Implements:** ADR-ACT-0061, ADR-ACT-0062, ADR-ACT-0063  
**Governed by:** ADR-0006, ADR-0007, ADR-0010, ADR-0011, ADR-0012

---

## Purpose

Validates and generates lifecycle transition evidence bundles. Every governed package lifecycle transition (e.g., `active.feature` → `stable.platform`) requires a committed evidence bundle under `docs/evidence/lifecycle/<package-name>/<date-from-to>/transition-evidence.{json,md}`. This tool validates existing bundles against `docs/schemas/lifecycle-transition-evidence.schema.json` and can generate new bundles.

---

## Location

```text
tools/architecture/validate-lifecycle-evidence/
  package.json     # @architecture/validate-lifecycle-evidence
  src/index.mjs
  tests/
    validate-lifecycle-evidence.test.mjs
    fixtures/
      valid/docs/evidence/lifecycle/package-a/.../transition-evidence.json
      valid/docs/schemas/lifecycle-transition-evidence.schema.json
      invalid/missing-approver/docs/evidence/lifecycle/package-a/.../transition-evidence.json
      invalid/missing-approver/docs/schemas/lifecycle-transition-evidence.schema.json
      source-repo/...   # source package + evidence for generation tests
      golden/generated-lifecycle-evidence/docs/evidence/lifecycle/fixture-package-a/.../transition-evidence.{json,md}
```

---

## CLI contract (ADR-0011)

```bash
node tools/architecture/validate-lifecycle-evidence/src/index.mjs \
  [--root <path>] [--format text|json] [--no-reports] \
  [--check | --write] [--allow-missing-ajv] \
  [--package <name>] [--from-class <class>] [--to-class <class>] \
  [--reason <text>] [--created-by <id>] [--reviewer <id>] [--approver <id>]
```

| Flag                   | Behaviour                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `--root <path>`        | Repository root. Default: nearest ancestor with `docs/schemas/`.                                                 |
| `--format text\|json`  | Console output format.                                                                                           |
| `--no-reports`         | Skip self-evidence.                                                                                              |
| `--check`              | Validate all evidence bundles under `docs/evidence/lifecycle/`. Default.                                         |
| `--write`              | Generate a new evidence bundle for the specified transition. Requires `--package`, `--from-class`, `--to-class`. |
| `--allow-missing-ajv`  | Treat missing Ajv as a warning.                                                                                  |
| `--package <name>`     | Package npm name for generation.                                                                                 |
| `--from-class <class>` | Source lifecycle class (e.g., `active.feature`).                                                                 |
| `--to-class <class>`   | Target lifecycle class (e.g., `stable.platform`).                                                                |
| `--reason <text>`      | Human-readable transition reason.                                                                                |
| `--created-by <id>`    | Identity of the evidence creator. Default: `"architecture-tooling"`.                                             |
| `--reviewer <id>`      | Identity of the reviewer. Default: `"architecture-reviewer"`.                                                    |
| `--approver <id>`      | Identity of the approver. Default: `"architecture-approver"`.                                                    |
| positional args        | Evidence search roots (check mode). Default: `docs/evidence/lifecycle`.                                          |

**Exit codes:** `0` = all evidence bundles valid (check) or bundle generated (write). `1` = any invalid bundle or generation failure.

**Environment variable:** `ARCHITECTURE_EVIDENCE_CREATED_AT` — if set, overrides `bundle.createdAt` and `transition.requestedAt` timestamps in generated bundles. Used in tests for deterministic golden-file comparison.

---

## Evidence bundle format (ADR-0010)

Evidence bundles are stored at:

```text
docs/evidence/lifecycle/<package-name>/<YYYY-MM-DD-from-class-to-to-class>/
  transition-evidence.json
  transition-evidence.md
```

The JSON schema at `docs/schemas/lifecycle-transition-evidence.schema.json` governs the nested structure:

```json
{
  "schemaVersion": "1.0",
  "bundle":   { "id", "createdAt", "createdBy", "status" },
  "package":  { "name", "path", "owner" },
  "transition": { "fromClass", "toClass", "reason", "requestedAt" },
  "governance": { "decisionRefs": ["ADR-NNNN"], "reviewers": [{"name","role","reviewedAt","evidenceRef"}], "approvers": [...] },
  "risk":     { "level", "assessment", "mitigations": [] },
  "testing":  { "summary", "evidence": [{"path","description"}] },
  "impact":   { "runtimeImpact", "consumerImpact" },
  "rollback": { "strategy", "notes" },
  "sourceMetadataSnapshot": { "packageJsonPath", "architecture": { ... } },
  "reportReferences": [{"path","description"}]
}
```

There is no `evidenceType` or `approved` field. The Markdown file is a human-readable summary rendered from the JSON fields.

---

## Validation (--check mode)

1. Load `docs/schemas/lifecycle-transition-evidence.schema.json`
2. Walk `docs/evidence/lifecycle/` recursively, find all `transition-evidence.json` files
3. Validate each against the schema via Ajv (falls back to structural checks if Ajv absent and `--allow-missing-ajv`)
4. Report per-bundle pass/fail with field-level error messages

---

## Generation (--write mode)

1. Locates the target package's `package.json` by scanning `apps/`, `packages/`, and `tools/architecture/` for a `name` field matching `--package`
2. Constructs the evidence bundle JSON from provided arguments + current timestamp (overridable via `ARCHITECTURE_EVIDENCE_CREATED_AT` for deterministic tests)
3. Reads `package.json` architecture metadata only to populate `sourceMetadataSnapshot.architecture` and `package.owner` — does **not** validate that the current lifecycle class matches `--from-class`
4. Renders the Markdown summary
5. Creates the evidence directory (`docs/evidence/lifecycle/<pkg-slug>/<date-from-to>/`) and writes both files; overwrites silently if the directory already exists

---

## Self-evidence (gitignored)

`reports/tooling/validate-lifecycle-evidence/<ISO-timestamp>-run.json`

`mode` is `"check"` or `"write"`. For write mode, `outputPaths` lists the generated evidence files.

---

## Test strategy (ADR-0012)

### Valid evidence test

Run `--check` against `fixtures/valid/`; assert exit 0.

### Invalid evidence test

Run `--check` against `fixtures/invalid/missing-approver/`; assert exit 1 with error identifying the missing field.

### Golden generation test

Run `--write` against `fixtures/source-repo/` with fixed arguments; compare output byte-for-byte against `fixtures/golden/generated-lifecycle-evidence/`. Uses a fixed `--created-by` and timestamp override for determinism.

### Transition class coverage

`fixtures/coverage/` contains separate fixture bundles for each of the seven lifecycle role transitions: `stable`, `external`, `deprecated`, `contract`, `adapter`, `tooling`, and `test`. Each fixture is a minimal valid `transition-evidence.json` and matching schema. Invalid variants (e.g., missing `governance.approvers`) are co-located and asserted to produce exit 1 with a field-level error message.

### Self-evidence suppression

Run with `--no-reports`; assert no tooling report files written.
