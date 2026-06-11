---
name: adr-compliance
description: Validate that new/changed ADRs, ACTION-REGISTER rows, CODEMAPS entries, evidence files, and status transitions are mutually consistent. Use when an ADR is added/edited, an ACTION-REGISTER row changes, a CODEMAPS entry changes, an evidence file is added, or a Done/Deferred/Superseded transition is proposed.
---

# ADR & governance consistency review

You validate the ADR governance system's internal consistency. You do **not** review code constraints —
that is the `architecture-boundary-review` skill / `architecture-constraints` agent. Make no product changes.

## Trigger conditions

- A new ADR is created or an existing ADR edited (`docs/adr/NNNN-*.md`).
- A row in `docs/adr/ACTION-REGISTER.md` is added or its Status/Evidence/Depends-on changes.
- A `docs/CODEMAPS/*.md` entry changes (counts, links, ADR list).
- A new `docs/evidence/<area>/` file is added or an evidence link changes.
- A status transition to `Done`, `Deferred`, or `Superseded` is proposed.

## Files / dirs to inspect

- `docs/adr/ACTION-REGISTER.md` — authoritative source for next ADR number, next action ID, status/type vocab.
- `docs/adr/0000-template.md` and the changed `docs/adr/NNNN-*.md`.
- `docs/adr/README.md`, `docs/CODEMAPS/{README,adrs,packages,apps,boundaries,infra}.md`.
- The `docs/evidence/<area>/` file referenced by any changed row.
- `docs/adr/0007-*.md` when a **new** `docs/evidence/` subdirectory is introduced.

## Checks

1. **Numbering:** new ADR uses the next free number; new action uses the next free `ADR-ACT-####` ID (both per `ACTION-REGISTER.md`, not assumed).
2. **Template:** ADR follows `0000-template.md` sections (Context/Decision/Status/Consequences).
3. **Row integrity:** every row has a `Source ADR`; `Status` ∈ {Open, In Progress, Blocked, Done, Deferred, Superseded}; `Type` ∈ {ADR, Implementation, Validation, Governance, Tooling, CI, Review}; `Depends on` references a real prior row.
4. **Evidence linkage:** any `Done` row's `Evidence` path exists on disk and points back to the row/ADR. (Constraint #9 — never `Done` without evidence.)
5. **Codemaps accuracy:** counts/links in CODEMAPS still match reality after the change (ADR count, package count, boundary-rule count).
6. **ADR-0007:** a new `docs/evidence/` subdirectory is reflected in ADR-0007.
7. **Supersession:** `Superseded` rows name the superseding ADR/row.

## Commands to run / recommend

```bash
node tools/architecture/validate-action-register/src/index.mjs   # register structural validation
npm run lint:md                                                  # markdown lint (changed files)
```

Recommend `node tools/architecture/orchestrator/src/index.mjs all --no-reports --strict` if the change is
broad. Do not run full test/build sweeps for a docs-only governance change.

## Report template

```text
ADR/governance consistency: PASS | ISSUES

Scope: <ADRs / rows / codemaps / evidence touched>
Numbering: <next-number correct? Y/N>
Row integrity: <ok / list problems with row IDs>
Evidence linkage: <each Done row -> evidence file exists? Y/N + paths>
Codemaps: <counts/links accurate? Y/N>
validate-action-register: <PASS/FAIL + key output>
lint:md: <PASS/FAIL>
Issues: <file:row — problem — fix>
```
