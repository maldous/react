# Environment operations foundation

Source ADR: ADR-0072 · Action: ADR-ACT-0274

## Scope delivered

A controlled boundary over environment bootstrap/operation actions.

- `ports/environment-operation.ts` — `EnvironmentOperationPort` over a CLOSED enum of
  operation kinds (no free-form command field) + `ArgvRunner` (no-shell argv runner) +
  `EnvironmentOperationRejected`
- `adapters/compose-environment-operation.ts` — resolves each op to a whitelisted argv
  from the registry record; rejects unknown profiles + mock profiles in staging/prod;
  `down`/`restart` never pass `-v`/`--volumes` (no data-destructive reset);
  `rotateSecret` KEY + `runProof` name pattern-validated; dry-run capable; runs via the
  injected `ArgvRunner` (execFile semantics, never a shell string)
- `usecases/environment-operations.ts` — maps each kind to a required
  `platform.environment.*` permission; audits `EnvironmentOperationInvoked` before
  execution

## Hard restrictions (proven)

- no arbitrary command / shell / docker socket (closed enum; argv only)
- no unclassified provider profile (must be in the env's `allowedProfiles`)
- no mock provider profile in staging/production
- no destructive reset (down/restart never carry `-v`/`--volumes`)
- all operations permissioned (operator-only) and audited; all dry-run capable

## Proof (deterministic — no Docker)

`npm run proof:environment-operations`: closed enum, argv-not-shell (no shell
metacharacters), profile whitelist, mock-in-prod ban, no-volume guard, rotate/proof
pattern validation, cross-environment rejection, permission enforcement, audit.

## Not delivered

Live compose/Tilt execution proof (the adapter is proven with an injected runner; live
execution is exercised through the Make targets in `make all`).

## Linkage

ADR-0072 · ADR-ACT-0274.
