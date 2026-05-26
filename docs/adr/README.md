# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs).

ADRs record material decisions that shape the product, architecture, data model, delivery process, security posture, operations model, and production behaviour.

They explain why a decision was reasonable at the time it was made.

## Purpose

ADRs help future reviewers understand:

- what was decided
- why it was decided
- what options were considered
- what trade-offs were accepted
- what evidence supported the decision
- who owned the decision
- what areas were impacted
- whether AI contributed to the decision
- whether the decision has been superseded

ADRs are not a replacement for design documents, runbooks, threat models, test plans, release notes, API documentation, or delivery tickets.

They are the durable decision history.

## Canonical ADR files

```text
docs/adr/README.md
docs/adr/0000-template.md
docs/adr/ACTION-REGISTER.md
```

The README defines the ADR process.

The template defines how ADRs are written.

The action register coordinates ADR-driven follow-up work.

There is no separate ADR or principle file for the ADR process itself.

## Standards and references

This ADR process is aligned with common ADR practice and architecture description standards.

References:

- Michael Nygard, `Documenting Architecture Decisions`, 2011.
  - Establishes the lightweight ADR pattern centred on title, status, context, decision, and consequences.
  - Reference: https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions

- Martin Fowler, `Architecture Decision Record`.
  - Describes ADRs as lightweight records focused on decision, context, and consequences.
  - Reference: https://martinfowler.com/bliki/ArchitectureDecisionRecord.html

- ADR GitHub organisation.
  - Defines architecture decisions as justified design choices addressing architecturally significant requirements.
  - Reference: https://adr.github.io/

- MADR, Markdown Architectural Decision Records.
  - Provides a structured Markdown ADR format with context, options, decision outcome, and consequences.
  - Reference: https://adr.github.io/madr/

- ISO/IEC/IEEE 42010 architecture description concepts.
  - Defines architecture description concepts including stakeholders, concerns, rationale, architecture decisions, alternatives, trade-offs, and consequences.
  - Reference: https://www.iso-architecture.org/42010/
  - Reference: https://www.iso.org/standard/74393.html

- Microsoft Azure Well-Architected Framework, `Maintain an architecture decision record`.
  - Recommends documenting key architecturally significant decisions, alternatives ruled out, context, justifications, and implications.
  - Reference: https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record

## When to create an ADR

Create an ADR for material decisions affecting:

- product scope or product behaviour
- domain model or bounded contexts
- application architecture
- data ownership or data flow
- API design or API boundaries
- integration patterns
- security, privacy, or access control
- testing and assurance strategy
- deployment or release process
- operations and support model
- observability and monitoring
- cost control
- AI-assisted development
- production readiness

Do not create an ADR for every small code change.

Create one when a decision creates a lasting constraint, risk, dependency, or standard.

## ADR filename convention

Use numeric prefixes and decision-oriented names.

Format:

```text
NNNN-decision-summary.md
```

Examples:

```text
0001-use-modular-hexagonal-architecture.md
0002-model-the-platform-around-bounded-contexts.md
0003-use-a-modular-monorepo-with-promotion-ready-package-boundaries.md
0004-define-package-lifecycle-classes.md
```

Use decision-style filenames.

Avoid question-style filenames once the decision is accepted.

## Status lifecycle

Use one of these statuses:

```text
Proposed
Accepted
Superseded
Deprecated
Rejected
```

Accepted ADRs are controlled decision records.

Do not silently rewrite accepted decisions in place.

If a decision changes, create a new ADR and supersede the old ADR.

## ADR action register

Material follow-up actions from ADRs are coordinated through:

```text
docs/adr/ACTION-REGISTER.md
```

The register is the single source of truth for ADR-driven work.

ADRs should not contain detailed follow-up task lists.

Inside an ADR, the `Follow-up actions` section should only point to the register.

The register is a coordination artifact, not a decision record.

It is not an ADR and does not consume an ADR number.

## Review expectations

An ADR should be reviewed before acceptance when it affects:

- architecture
- data ownership
- security
- privacy
- production operations
- delivery process
- public API contracts
- customer-facing behaviour
- material cost or performance

Reviewers should check:

- the decision is clear
- the context explains why the decision matters
- options are compared fairly
- consequences include negatives
- evidence is proportional to risk
- ownership is clear
- AI involvement is disclosed where applicable
- ADR-driven follow-up actions are recorded in the action register

## Evidence expectations

Evidence should be proportional to decision risk.

```text
Low-risk decision:
  documented reasoning
  code reference or local test output

Medium-risk decision:
  documented reasoning
  prototype or spike
  integration test, benchmark, or representative validation

High-risk decision:
  documented reasoning
  standards or vendor references
  security, data, operational, or production-readiness review
  explicit risk acceptance where needed
```

Avoid decisions based only on preference.

## AI-assisted decision rules

AI may assist with drafting, option comparison, risk identification, consistency review, diagrams, and validation planning.

AI must not be treated as the decision owner.

A human owner must review claims, validate facts, accept or reject recommendations, record uncertainty, and approve final ADR status.

## Definition of Done expectations

For a vertical slice or material change, Definition of Done should include:

- relevant ADRs created or updated
- affected ADRs linked in the pull request
- superseded decisions marked correctly
- evidence or validation attached
- ADR-driven follow-up actions recorded in `docs/adr/ACTION-REGISTER.md`

## ADR quality checklist

Before accepting an ADR, confirm:

- [ ] The decision is clearly stated.
- [ ] The context explains why the decision matters.
- [ ] Multiple options were considered where practical.
- [ ] Trade-offs are explicit.
- [ ] Consequences include negatives.
- [ ] Ownership is clear.
- [ ] Evidence is proportional to risk.
- [ ] AI usage is disclosed if applicable.
- [ ] Follow-up actions are recorded in `docs/adr/ACTION-REGISTER.md`, not duplicated in the ADR.
- [ ] Supersession links are present where needed.
- [ ] References are recorded where external claims or standards are used.

## Directory structure

Recommended structure:

```text
docs/
  adr/
    README.md
    0000-template.md
    ACTION-REGISTER.md
    0001-use-modular-hexagonal-architecture.md
    0002-model-the-platform-around-bounded-contexts.md
    0003-use-a-modular-monorepo-with-promotion-ready-package-boundaries.md
    0004-define-package-lifecycle-classes.md
```

## Summary

ADRs are the product's decision memory.

The standard is simple:

```text
Record material decisions.
Compare real options.
Explain trade-offs.
Provide evidence.
Assign ownership.
Disclose AI assistance.
Coordinate follow-up work in the action register.
Preserve history.
```
