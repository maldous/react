# Universal Service Foundation — scope and principles

> Governing decision: **ADR-0053** (Proposed). Capability state: [`docs/evidence/platform/universal-service-foundation-matrix.md`](../evidence/platform/universal-service-foundation-matrix.md).

## What this is

The Universal Service Foundation (USF) is the target architecture for evolving this repository from a **tenant control-plane foundation** into a **multipurpose software-provider substrate** — a set of composable capabilities on which future SaaS products and enterprise applications can be built.

It is **not** a UI/admin console, a single product, or a collection of running containers. It is a disciplined substrate where every capability is expressed through the existing hexagonal architecture.

## What "foundation" means here

A capability is part of the foundation only when it is expressed through the full platform style:

- an ADR and an ACTION-REGISTER entry
- a hexagonal port and an adapter
- a BFF contract and a route scope
- a permission model and tenant isolation model
- audit events and a readiness model
- a runtime proof and an evidence document
- an admin UI surface and a self-service UI surface where applicable
- a production classification (environment model + isolation)

A container that exists in `compose.yaml` is infrastructure, not a foundation capability.

## Non-negotiable principles

1. **Free local-first.** Every capability must have a free local development path. No capability may require a paid SaaS account to run, test, or prove locally. Paid providers are later production adapters only. The single unavoidable exception is payment capture (ADR-0057), which is isolated behind an adapter and explicitly documented as not locally provable end-to-end.
2. **Build vs compose is a deliberate decision.** Every capability is classified `build` / `compose` / `adapter` / `defer` / `reject` using the framework in [`build-versus-compose-decision-framework.md`](./build-versus-compose-decision-framework.md). Mature capabilities are not rewritten without a recorded architectural reason.
3. **Environment-specific vs shared is explicit.** Every service is classified per [`environment-service-classification.md`](./environment-service-classification.md). Tenant runtime data defaults to per-environment. Shared services carry a full isolation/leakage checklist.
4. **No fake readiness.** Status uses the controlled vocabulary; "complete" is not permitted. A running service is not a delivered platform capability.
5. **Architecture compliance.** Every future capability satisfies the full checklist above before it can be called delivered.

## Relationship to the existing platform

The USF generalises capabilities the repo already has rather than replacing them:

- The **capability registry** (`capability-registry.ts`) and **tenant readiness** model become the template for every new capability's readiness.
- The **service catalog** (`platform-services.ts`) and **clickthrough policy** (`service-clickthrough.ts`) become the seed of the service-catalog + provider model (ADR-0055).
- The **webhook substrate** (ADR-0051/0052) becomes the seed of internal eventing and workflow (ADR-0059).
- The **proof ladder** (`proof-registry.ts`) and **evidence governance** (ADR-0007) extend to every new substrate.

## Scope boundary (in / out)

In scope: identity/access, authentication, configuration, billing/metering/entitlements, data platform, search, storage, events/queues/workflows, compute/runtime, observability/alerting/incident, security/governance, developer platform, support/enterprise administration.

Out of scope (rejected as non-core unless a concrete product need is proven): general-purpose serverless function hosting for arbitrary tenant code (deferred, ADR-0055/0059), and any capability that cannot satisfy the local-first principle.

## How to use this document

- Start any new substrate work from the matrix row and its registry entry.
- Confirm the build/compose decision and environment classification before composing anything.
- Create or update the relevant ADR (ADR-0057..0066) and ACTION-REGISTER row.
- Do not mark anything delivered without route/contract/proof/evidence.
