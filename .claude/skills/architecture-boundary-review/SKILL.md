---
name: architecture-boundary-review
description: Review changes against this repo's hexagonal boundaries — import rules, contracts/ports/adapters, BFF-only frontend data access, server-side tenant authority, and the 10 critical constraints in CLAUDE.md. Use when packages, imports, contracts, ports, adapters, the BFF, or React data-fetching change.
---

# Hexagonal boundary review

Review code changes for architectural boundary violations. Report findings; make no product changes.
The `architecture-constraints` subagent encodes the 10 constraints and can be delegated the diff; run
`npm run semgrep` for a fast mechanical first pass.

## Trigger conditions

- Any change to a `packages/*` package, its `package.json::architecture`, or imports.
- New/changed contracts, ports, adapters, or use-cases.
- React code that fetches or mutates server data.
- New cross-package dependency or a new adapter.

## Files / dirs to inspect

- `docs/architecture/import-boundary-rules.json` + `import-boundary-rules.md` (the 39 rules).
- `docs/CODEMAPS/boundaries.md`, `docs/CODEMAPS/packages.md`.
- Changed `packages/*/package.json` `architecture` blocks and source.
- `apps/platform-api/**` (BFF) and `apps/react-enterprise-app/**` (SPA).
- ADRs 0001, 0003, 0004, 0006, 0013, 0029, 0030 for layering/tenancy intent.

## Checks (the 10 critical constraints + layering)

1. No BFF bypass — React must reach server data only through the BFF.
2. No DB/Redis/Keycloak SDK/token-exchange/migrations/server-only observability in the React app.
3. No adapter imports from domain, feature, UI, or contract packages.
4. No `pino` in domain/feature/UI/contract packages.
5. No OpenTelemetry SDK in `platform-observability`.
6. No raw `throw new Error` on expected failure paths — use `platform-errors` typed errors.
7. No `console.log`/`console.error` in app runtime, BFF, or adapter code — use `platform-logging`.
8. No secrets/real payloads in WireMock mappings.
9. Contracts stay pure (no adapter/runtime imports); ports define interfaces only.
10. Tenant authority stays server-side; the SPA never decides tenant authorisation.

## Commands to run / recommend

```bash
node tools/architecture/orchestrator/src/index.mjs all --no-reports --strict   # metadata + imports + more
npm run depcruise          # dependency-cruiser boundary check
npm run frontend:conventions
```

## Report template

```text
Boundary review: PASS | VIOLATIONS

Scope: <files/packages>
Import rules: <orchestrator sourceImports PASS/FAIL>
Constraint violations: <file:line — constraint # — problem>
Contract/port purity: <ok / issues>
BFF-only & tenant authority: <ok / issues>
depcruise: <PASS/FAIL>
Recommended fix order: <...>
```
