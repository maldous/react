# Evidence: ADR-ACT-0132 ? WireMock contract policy

**Date:** 2026-05-29
**Status:** Done
**Action:** ADR-ACT-0132
**ADR Ref:** ADR-0017

## Scope

This action requires adapter contract tests against WireMock mappings, or explicit evidence explaining why WireMock is not applicable.

## Evidence

The current external HTTP adapter surface is `packages/adapters-keycloak`.
Its contract is already exercised directly at the adapter boundary by
`packages/adapters-keycloak/tests/adapters-keycloak.test.ts`, which verifies:

- Keycloak authorization URL construction
- token exchange request/response handling
- `/userinfo` fetch handling
- email verification and claim mapping rules

Those tests are focused on the adapter contract itself, using controlled fetch
mocks to assert the exact HTTP semantics and failure modes without introducing
another moving part into the adapter boundary.

WireMock remains available for future external HTTP adapters and service-level
E2E stubbing, via `docker/wiremock/mappings/` and the `external-mocks`
Compose profile. For the current Keycloak adapter, the existing contract tests
already cover the adapter?s HTTP contract directly and deterministically.

## Result

ADR-ACT-0132 is satisfied by adapter-boundary contract tests and documented
WireMock applicability limits for the current surface.
