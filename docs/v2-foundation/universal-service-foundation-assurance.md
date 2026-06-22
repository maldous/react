# Universal Service Foundation Assurance

Status: PASS

This attestation is generated from `docs/v2-foundation/usf-graph/` and the V2 readiness semantic artefacts.
It extends formal semantic assurance into operational, observability, security, audit, event, environment, data, dependency, reliability, capability coverage, and runtime alignment assurance.

| Assurance Domain              | Result | Rationale                                                                                                                                                         |
| ----------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semantic Assurance            | PASS   | R30-R37 formal semantic assurance remains enforced by v2:readiness.                                                                                               |
| Operational Assurance         | PASS   | 70 capabilities checked for deployment, config, migration, rollback, backup/restore, degraded/recovery modes, owner action, incidents, and runbook. violations=0. |
| Observability Assurance       | PASS   | 70 capabilities checked for traces, logs, metrics, alerts, mutation audit, and event trace correlation. violations=0.                                             |
| Security Assurance            | PASS   | 70 capabilities checked for permissions, RBAC/ABAC/PDP policy, audit, secrets, data classification, and security risk. violations=0.                              |
| Audit Assurance               | PASS   | 11 mutating capabilities checked for audit event, before/after, actor, resource, timestamp, and correlation. violations=0.                                        |
| Event Assurance               | PASS   | 10 events checked for owner, producer, consumer, schema, version, idempotency, retry, DLQ, retention, and privacy. violations=0.                                  |
| Environment Assurance         | PASS   | 280 Capability x Environment cells checked for provider, mock/proof/promotion/rollback/tenant-data/network/secret policy. violations=0.                           |
| Data Assurance                | PASS   | 36 tenant-data capabilities checked for owner, classification, retention, backup, restore, export, legal hold, DSR, and lineage. violations=0.                    |
| Dependency Assurance          | PASS   | 10 capability dependencies and 70 provider dependencies checked for ownership and explicit risk. violations=0.                                                    |
| Reliability Assurance         | PASS   | 64 provider-backed capabilities checked for timeout, retry, circuit-breaker/degraded, fallback, and recovery semantics. violations=0.                             |
| Capability Coverage Assurance | PASS   | 70 capabilities checked across semantics, proofs, events, environments, operations, security, audit, observability, and governance. violations=0.                 |
| Runtime Alignment Assurance   | PASS   | 70 capabilities checked for semantic definition + proof + runtime evidence alignment. violations=0.                                                               |

The platform can answer assurance questions through the generated graph and report artefacts: unaudited mutations, untraced routes, capabilities without alerts, providers without degraded mode, events without DLQ, capabilities without recovery or ownership, tenant-data capabilities without backup, privileged actions without audit, environment contradictions, semantic orphans, and runtime claims without evidence.

## Adversarial Runtime Assurance

Status: FAIL

The semantic USF graph is not treated as sufficient proof. Runtime-derived inventories and adversarial reports are generated under `docs/v2-foundation/usf-audit/`. Any unknown route-level, interface-level, provider, workflow, storage, event, ownership, proof, or orphan evidence is classified as a gap.

## Adversarial Runtime Assurance

Status: FAIL

The semantic USF graph is not treated as sufficient proof. Runtime-derived inventories and adversarial reports are generated under `docs/v2-foundation/usf-audit/`. Any unknown route-level, interface-level, provider, workflow, storage, event, ownership, proof, or orphan evidence is classified as a gap.

## Adversarial Runtime Assurance

Status: FAIL

The semantic USF graph is not treated as sufficient proof. Runtime-derived inventories and adversarial reports are generated under `docs/v2-foundation/usf-audit/`. Any unknown route-level, interface-level, provider, workflow, storage, event, ownership, proof, or orphan evidence is classified as a gap.

## Adversarial Runtime Assurance

Status: FAIL

The semantic USF graph is not treated as sufficient proof. Runtime-derived inventories and adversarial reports are generated under `docs/v2-foundation/usf-audit/`. Any unknown route-level, interface-level, provider, workflow, storage, event, ownership, proof, or orphan evidence is classified as a gap.

## Adversarial Runtime Assurance

Status: FAIL

The semantic USF graph is not treated as sufficient proof. Runtime-derived inventories and adversarial reports are generated under `docs/v2-foundation/usf-audit/`. Any unknown route-level, interface-level, provider, workflow, storage, event, ownership, proof, or orphan evidence is classified as a gap.

## Adversarial Runtime Assurance

Status: FAIL

The semantic USF graph is not treated as sufficient proof. Runtime-derived inventories and adversarial reports are generated under `docs/v2-foundation/usf-audit/`. Any unknown route-level, interface-level, provider, workflow, storage, event, ownership, proof, or orphan evidence is classified as a gap.

## Adversarial Runtime Assurance

Status: FAIL

The semantic USF graph is not treated as sufficient proof. Runtime-derived inventories and adversarial reports are generated under `docs/v2-foundation/usf-audit/`. Any unknown route-level, interface-level, provider, workflow, storage, event, ownership, proof, or orphan evidence is classified as a gap.

## Adversarial Runtime Assurance

Status: FAIL

The semantic USF graph is not treated as sufficient proof. Runtime-derived inventories and adversarial reports are generated under `docs/v2-foundation/usf-audit/`. Any unknown route-level, interface-level, provider, workflow, storage, event, ownership, proof, or orphan evidence is classified as a gap.

## Adversarial Runtime Assurance

Status: FAIL

The semantic USF graph is not treated as sufficient proof. Runtime-derived inventories and adversarial reports are generated under `docs/v2-foundation/usf-audit/`. Any unknown route-level, interface-level, provider, workflow, storage, event, ownership, proof, or orphan evidence is classified as a gap.

## Known Gaps Identified

| Question                                              | Machine-generated answer |
| ----------------------------------------------------- | -----------------------: |
| Show every route without tracing.                     |                       28 |
| Show every route without logging.                     |                       28 |
| Show every route without metrics.                     |                       28 |
| Show every mutation without audit.                    |                      101 |
| Show every route without capability owner.            |                        0 |
| Show every capability without ownership.              |                        0 |
| Show every semantic orphan.                           |                        7 |
| Show every provider without unavailable-path proof.   |                     2559 |
| Show every workflow without failure-path proof.       |                      106 |
| Show every storage operation without lifecycle proof. |                      114 |
| Show every event without DLQ/retry proof.             |                        2 |
| Show every alert without runbook.                     |                      236 |

See `docs/v2-foundation/usf-audit/v1-correction-backlog.md` for classified gaps.
