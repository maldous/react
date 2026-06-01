# Third-Party Stakeholder Guide (ADR-ACT-0032)

This document explains the lifecycle stage, package roles, and semantic versioning
expectations for packages in this repository. Intended for: external contributors,
consumers of published packages, and third-party integrators.

## Lifecycle stage

This platform is in **active development (pre-1.0)**. APIs should be treated as
unstable; breaking changes may occur between minor versions until 1.0.0 is released.

## Package roles

Each package in `packages/` has a defined role governed by its `x-architecture` metadata:

| Package                    | Role                                                       | Stability   |
| -------------------------- | ---------------------------------------------------------- | ----------- |
| `contracts-auth`           | Auth session/permission contracts — consumed by BFF and UI | Evolving    |
| `domain-identity`          | Identity domain logic and permission resolution            | Evolving    |
| `platform-errors`          | Typed error hierarchy for BFF and adapters                 | Stable      |
| `platform-logging`         | Structured logging abstraction                             | Stable      |
| `platform-observability`   | OpenTelemetry integration                                  | Stable      |
| `platform-runtime-context` | Request context propagation                                | Stable      |
| `session-runtime`          | Session store contracts                                    | Evolving    |
| `adapters-redis`           | Redis session + state adapters                             | Evolving    |
| `adapters-postgres`        | PostgreSQL multi-tenant adapters                           | Evolving    |
| `adapters-keycloak`        | Keycloak OIDC/Admin adapters                               | Evolving    |
| `authorisation-runtime`    | UMA/policy authorisation port                              | Evolving    |
| `api-runtime`              | BFF API health/version contracts                           | Stable      |
| `audit-events`             | Audit event types and storage                              | Evolving    |
| `i18n-runtime`             | i18n hooks and React integration                           | Placeholder |

## Semver expectations

- **Patch (0.x.y → 0.x.(y+1))**: Bug fixes, internal refactors with no API surface change.
- **Minor (0.x.y → 0.(x+1).0)**: New exports or additive API changes. Existing consumers unaffected.
- **Major (0.x.y → 1.0.0 or 2.x.0)**: Breaking changes to exported types or function signatures.

Until 1.0.0, minor bumps may include breaking changes per npm semver convention for pre-release packages.

## Integration points

External consumers should depend on `contracts-auth`, `platform-errors`, and `platform-logging`.
All other packages are implementation detail and may change without notice.

## Governance

Package roles and lifecycle stages are enforced by the `validate-package-metadata`
architecture gate (`npm run test:architecture`). Changes to roles require updating
the `x-architecture` section of the relevant `package.json` and passing the gate.
