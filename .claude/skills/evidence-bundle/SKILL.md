---
name: evidence-bundle
description: Create or validate a docs/evidence/<area>/ file for a completed slice — scope delivered, decisions, tests run with proof layer, known deferrals, live/manual proof, and ACTION-REGISTER linkage. Use when finishing a slice or writing/checking an evidence file.
---

# Evidence bundle author / validator

Produce or validate a committed evidence file that records a reviewed governance event for a slice.
Mirror the existing repo shape; do not invent a new format. Make no product changes.

## Trigger conditions

- A slice is complete and needs an evidence file.
- An evidence file already exists and needs validating against its ACTION-REGISTER row.
- An ACTION-REGISTER row is being moved to `Done` (evidence is mandatory — constraint #9).

## Files / dirs to inspect

- The target `docs/evidence/<area>/<slice>.md` (create or read).
- A reference exemplar: `docs/evidence/platform/enterprise-control-plane-capability-map.md`.
- `docs/evidence/README.md` (what evidence is for; reports vs evidence).
- The matching `docs/adr/ACTION-REGISTER.md` row and its `Source ADR`.
- `docs/adr/0007-*.md` if introducing a **new** evidence subdirectory.

## Required sections (match repo convention)

1. Title + source line: `ADR-XXXX / ADR-ACT-XXXX`.
2. **Scope delivered** — what shipped, in plain terms.
3. **Decisions / model** — key choices and invariants.
4. **Matrix / inventory** — table of the delivered surface (routes, capabilities, etc.) where relevant.
5. **Tests run + proof layer** — classify each as live-proven / node:test-proven / MSW-proven / not-yet-proven (use the `live-proof` skill).
6. **Known deferrals** — explicitly out of scope.
7. **Action register status** — the row ID, current Status, and that this file is its Evidence.

## Checks when validating

- File exists at the path the register row names; row points back to the file.
- No secrets, tokens, cookies, or customer payloads (constraint #8).
- Proof claims are honest — nothing labelled live-proven without a run.
- New subdirectory reflected in ADR-0007.

## Commands to run / recommend

```bash
npm run lint:md
node tools/architecture/validate-action-register/src/index.mjs
```

## Report template

```text
Evidence bundle: CREATED | VALIDATED | ISSUES

File: docs/evidence/<area>/<slice>.md
Register row: ADR-ACT-#### (Status: ...)
Sections present: scope/decisions/matrix/tests+proof/deferrals/status — <list missing>
Proof honesty: <ok / overclaimed items>
Secret scan: <clean / findings>
Linkage: row <-> evidence consistent? Y/N
```
