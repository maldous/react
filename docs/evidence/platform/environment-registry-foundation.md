# Environment registry foundation

Source ADR: ADR-0072 · Action: ADR-ACT-0274

## Scope delivered

`environment_registry` (migration 033) is the application's canonical, queryable
understanding of the deployment ladder, projected from the tracked manifests plus
operational lifecycle state.

- `ports/environment-registry-repository.ts` — `EnvironmentRegistryRepository`
- `adapters/postgres-environment-registry-repository.ts` — operator-global,
  `withSystemAdmin`, no secret stored
- `usecases/environment-registry.ts` — `syncEnvironmentsFromManifests`, `register`,
  `list`/`get`, `recordBootstrap`/`recordReconcile`, `setProviderConfigStatus`;
  audited; every op gated by a `platform.environment.*` permission (operator-only)
- DB CHECK constraints forbid mocks + destructive operations in staging/production

## Proof (live)

`npm run proof:environment-registry` (against local Postgres):

- manifest sync projects the whole ladder (dev/test/staging/prod)
- registry record carries no secret-looking value
- staging/prod are `no-mocks` (allowedMocks empty); dev/test `mocks-allowed`
- staging/prod forbid destructive operations
- usecase rejects mocks in a staging environment; DB CHECK rejects
  `mock_policy=mocks-allowed` in production
- `list` without `platform.environment.read` is Forbidden; bootstrap without
  `platform.environment.bootstrap` is Forbidden
- `recordBootstrap` stamps `last_bootstrapped_at` (adapter-confirmed, not faked)

## Not delivered

`/admin/environments` REST/UI surface (registry + usecase are route-ready).

## Linkage

ADR-0072 · ADR-ACT-0274 · builds on ADR-0056 (classification), ADR-0070 (providers).
