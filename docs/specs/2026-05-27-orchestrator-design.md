# Design: orchestrator tool

**Date:** 2026-05-27  
**Status:** As-built  
**Implements:** ADR-ACT-0065, ADR-ACT-0067, ADR-ACT-0068  
**Governed by:** ADR-0011, ADR-0012

---

## Purpose

Runs all architecture governance tools in a governed dependency order. Provides a single entry point for local development, CI, and review workflows. Stops execution when a required dependency fails so downstream tools do not produce misleading results against invalid metadata. Emits orchestration self-evidence for auditability.

---

## Location

```
tools/architecture/orchestrator/
  package.json     # @architecture/orchestrator
  src/index.mjs
  tests/
    dependency-order.test.mjs
    check-mode.test.mjs
    write-mode.test.mjs
    failure-stop.test.mjs
    no-default-evidence-generation.test.mjs
    self-evidence.test.mjs
```

---

## CLI contract (ADR-0011)

```bash
node tools/architecture/orchestrator/src/index.mjs \
  [<command>] \
  [--root <path>] [--format text|json] [--no-reports] \
  [--plan-only] [--allow-missing-ajv] [--evidence-generation-requested]
```

| Flag | Behaviour |
|---|---|
| `--root <path>` | Repository root. Default: cwd. |
| `--format text\|json` | Console output format. |
| `--no-reports` | Pass `--no-reports` to all child tools; suppress orchestrator self-evidence. |
| `--plan-only` | Print the execution plan as JSON without running any tools. |
| `--allow-missing-ajv` | Pass `--allow-missing-ajv` to tools that support it. |
| `--evidence-generation-requested` | Guard flag required for `generate-lifecycle-evidence` command. |

**Exit codes:** `0` = all executed steps passed. `1` = any required step failed or unrecoverable error.

---

## Commands

| Command | Steps executed |
|---|---|
| `validate` (default) | `validate-package-metadata` |
| `all` | `validate-package-metadata` → `generate-package-readmes` (--check) → `generate-package-inventory` (--check) → `generate-lifecycle-reports` (--check, optional) → `validate-lifecycle-evidence` |
| `generate-readmes` | `validate-package-metadata` → `generate-package-readmes` (--write) |
| `generate-inventory` | `validate-package-metadata` → `generate-package-readmes` (--check) → `generate-package-inventory` (--write) |
| `generate-lifecycle-reports` | `validate-package-metadata` → `generate-package-readmes` (--check) → `generate-package-inventory` (--check) → `generate-lifecycle-reports` (--write) |
| `validate-evidence` | `validate-package-metadata` → `generate-package-readmes` (--check) → `generate-package-inventory` (--check) → `generate-lifecycle-reports` (--check) → `validate-lifecycle-evidence` |
| `generate-lifecycle-evidence` | `validate-package-metadata` → `generate-package-readmes` (--check) → `generate-package-inventory` (--check) → `generate-lifecycle-reports` (--check) → `validate-lifecycle-evidence` → `generate-lifecycle-evidence` (--write) |

---

## Dependency ordering and failure behaviour

Each step has a `required` flag. If a required step exits non-zero, the orchestrator stops immediately — no subsequent steps run. Optional steps (`generate-lifecycle-reports`) are skipped on failure but do not halt the pipeline.

Steps are invoked synchronously via `spawnSync`. The orchestrator does not run tools in parallel — ordered execution is load-bearing for the dependency model (later tools depend on outputs of earlier ones).

---

## Execution plan (--plan-only)

Returns a JSON object:

```json
{
  "command": "all",
  "dependencyOrder": ["validate-package-metadata", "generate-package-readmes", ...],
  "steps": [ { "name", "toolPath", "scriptPath", "args", "required" } ],
  "exitCode": 0,
  "evidencePath": null
}
```

Used by tests to assert dependency ordering without executing tools.

---

## Self-evidence (gitignored)

`reports/tooling/orchestrator/<ISO-timestamp>-run.json`

Contains: `toolName`, `command`, `steps` (with per-step name, exitCode, durationMs), `allPassed`, `stoppedAt` (name of step that caused early exit, if any), `exitCode`.

Evidence generation is **not** triggered by default — only by the `generate-lifecycle-evidence` command with `--evidence-generation-requested`. This prevents accidental committed-artifact mutation during routine checks.

---

## Repo root detection

The orchestrator resolves the repo root by walking up from `--root` (defaulting to `process.cwd()`) until it finds `docs/schemas/package-json-architecture.schema.json`. This means it can be invoked from any subdirectory of the repo.

---

## Test strategy (ADR-0012)

All orchestrator tests use `spawnSync` against the tool script with `--plan-only` or full execution against the real repo root.

| Test file | What it covers |
|---|---|
| `dependency-order.test.mjs` | `all` command plan has the correct dependency sequence |
| `check-mode.test.mjs` | All check-mode commands exit 0 on a valid repo |
| `write-mode.test.mjs` | Write commands produce expected outputs |
| `failure-stop.test.mjs` | A failing required step halts subsequent steps |
| `no-default-evidence-generation.test.mjs` | `all` and `validate-evidence` do not generate lifecycle evidence by default |
| `self-evidence.test.mjs` | Self-evidence JSON contains required fields; `--no-reports` suppresses it |
