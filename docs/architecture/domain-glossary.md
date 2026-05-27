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

## API runtime

The HTTP server lifecycle package that owns request routing, middleware pipeline (auth, logging, tracing, rate-limiting), and structured response envelope. All inbound requests pass through this boundary before reaching domain logic.

## GraphQL API runtime

The GraphQL server runtime package that mounts a GraphQL endpoint on the HTTP API server, stitches schema from contract packages, and provides DataLoader-scoped resolver context.

## worker runtime

The background worker process lifecycle package that owns job queue consumption, retry and backoff policy, concurrency control, and graceful shutdown. Job processor functions are registered from feature or domain packages.

## config runtime

The configuration service package that loads environment variables at process start, validates them against a typed schema, and provides readonly typed config accessors to other platform packages.

## session runtime

The server-side session service package that stores and retrieves session state (backed by Redis), binds authentication tokens to session records, and propagates user claims through the request context.

## security auth

The authentication abstraction package that defines the auth provider interface, typed identity and claims contracts, and RBAC primitives. Concrete providers (adapters-keycloak) implement this interface.

## audit events

The audit event bus package that defines the canonical audit event schema and emitter interface. It guarantees durable delivery of structured audit records for security-relevant actions.

## observability

The observability abstraction package that defines the structured logger, metrics emitter, tracer, and health check interfaces. Concrete adapters (adapters-sentry, adapters-opentelemetry) implement these interfaces.

## queue runtime

The queue abstraction package that defines the typed job enqueue interface, queue topology contracts, and delivery guarantee semantics. The concrete broker (adapters-redis/BullMQ) implements this interface.

## storage runtime

The object storage abstraction package that defines the file upload interface, presigned URL contracts, and bucket policy semantics. The concrete provider (adapters-object-storage) implements this interface.

## operations adapter

An adapter package in the operations domain that implements a platform interface against a specific technology (Keycloak, Redis, Sentry, OpenTelemetry, S3). Operations adapters must not be imported directly by feature or domain packages.

## delivery package

A non-production package that supports the software delivery pipeline. Delivery packages own Docker container definitions, Terraform infrastructure configurations, CI/CD workflow definitions, and local development environment setup. They are never imported by platform code at runtime.

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
