# Domain glossary

This glossary intentionally uses generic architecture language and does not assume the product domain.

## app shell

The browser application entry point that owns route composition, runtime bootstrapping, authentication boundary wiring, and application-level error boundaries.

## workflow feature

A user-facing workflow package that composes UI, domain-core rules, profile/configuration, access-control decisions, and generated contracts without owning runtime transport.

## UI design system

A presentational React package that owns reusable accessible components and does not fetch GraphQL data.

## domain-core package

A pure TypeScript package that owns generic business-rule primitives, validation patterns, state transitions, and domain language boundaries without assuming a specific product domain.

## profile configuration

The generic user, organisation, preference, entitlement, setting, and runtime configuration model. It is storage-independent and expected to persist through PostgreSQL adapters.

## access control

The generic role and permission model for admin, staff, user, service, and support roles. It defines capability policy but does not own authentication or identity-provider integration.

## external ingestion

The boundary for receiving and normalising data from external systems. Ingestion contracts describe payloads and envelopes. Ingestion adapters own runtime source integration.

## PostgreSQL transactional store

The expected transactional persistence boundary for profile configuration, role assignments, operational state, and other strongly consistent application data.

## ClickHouse analytical store

The expected analytical storage boundary for high-volume events, external ingestion history, reporting data, and query-optimised analytical workloads.

## GraphQL contract package

A package that owns GraphQL operations, fragments, generated operation types, and TypedDocumentNode artifacts.

## GraphQL adapter package

A package that binds generated GraphQL contract documents to runtime transport, cache policy, PostgreSQL transactional adapters, and ClickHouse analytical adapters.

## tooling package

A development or CI package that owns generation commands, validation utilities, and artifact workflows.

## test support package

A test-only package containing MSW GraphQL handlers, React Testing Library helpers, Playwright fixtures, generic role fixtures, ingestion fixtures, and analytics fixtures.

## package domain

The `architecture.component.domain` value in package metadata. It maps a package to a domain value from the context map.

## bounded context

The `architecture.component.boundedContext` value in package metadata. It maps a package to a context with internally consistent language and ownership.

## lifecycle class

The `<stage>.<role>` package classification defined by lifecycle metadata.
