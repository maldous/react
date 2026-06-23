# Adversarial USF Assurance Attestation

Status: FAIL

This attestation is generated from runtime-derived inventories under `docs/v2-foundation/usf-audit/`.
Overall PASS is not allowed unless runtime/interface-level route, security, ownership, audit, proof, storage, workflow, event, metrics, data-governance, provider, orphan, and formal proof-readiness checks all have zero gaps.
The adversarial runtime inventory status is reported separately from formal proof readiness so runtime inventory closure cannot be mistaken for full migration proof.

| Measure                                     | Count |
| ------------------------------------------- | ----: |
| adversarial runtime status                  |  PASS |
| formal proof readiness status               |  FAIL |
| formal proof readiness gaps                 |  2743 |
| capability proof readiness gaps             |    89 |
| full-service/provider-verified capabilities |     0 |
| fully proven capabilities                   |     0 |
| routes discovered                           |   235 |
| routes without tracing                      |     0 |
| routes without logging                      |     0 |
| routes without metrics                      |     0 |
| mutations without audit                     |     0 |
| capabilities without ownership              |     0 |
| semantic orphans                            |     0 |
| runtime orphans                             |     0 |
| provider reliability gaps                   |     0 |
| workflow proof gaps                         |     0 |
| storage proof gaps                          |     0 |
| event runtime gaps                          |     0 |
| false-positive items                        |     0 |
| external-limited items                      |     0 |
| duplicate findings                          |     0 |
| obsolete-runtime-artifact items             |     0 |
| must-fix-in-v1 items                        |     0 |

## Runtime Audit Gaps Identified

- none

## Formal Proof Readiness Gaps Identified

- proof-command-failed: apps/platform-api/scripts/alert-incident-closure-runtime-proof.ts - proof command exited 1
- proof-claim-overstated: apps/platform-api/scripts/alert-incident-closure-runtime-proof.ts - claimed L4 exceeds observed L0
- test-l4-provider-mode: apps/platform-api/scripts/alert-incident-closure-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/alert-incident-closure-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/alert-incident-closure-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/alert-incident-closure-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/alert-incident-closure-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/alert-incident-closure-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/alert-incident-closure-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-claim-overstated: apps/platform-api/scripts/alert-notification-bridge-runtime-proof.ts - claimed L4 exceeds observed L1
- test-l4-provider-mode: apps/platform-api/scripts/alert-notification-bridge-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/alert-notification-bridge-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/alert-notification-bridge-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/alert-notification-bridge-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/alert-notification-bridge-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/alert-notification-bridge-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/alert-notification-bridge-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-claim-overstated: apps/platform-api/scripts/alerting-runtime-proof.ts - claimed L4 exceeds observed L1
- test-l4-provider-mode: apps/platform-api/scripts/alerting-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/alerting-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/alerting-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/alerting-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/alerting-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/alerting-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/alerting-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-claim-overstated: apps/platform-api/scripts/api-key-routes-runtime-proof.ts - claimed L4 exceeds observed L1
- test-l4-provider-mode: apps/platform-api/scripts/api-key-routes-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/api-key-routes-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/api-key-routes-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/api-key-routes-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/api-key-routes-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/api-key-routes-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/api-key-routes-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-claim-overstated: apps/platform-api/scripts/api-keys-runtime-proof.ts - claimed L4 exceeds observed L1
- test-l4-provider-mode: apps/platform-api/scripts/api-keys-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/api-keys-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/api-keys-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/api-keys-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/api-keys-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/api-keys-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/api-keys-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-command-failed: apps/platform-api/scripts/auth-settings-runtime-proof.ts - proof command exited 2
- proof-claim-overstated: apps/platform-api/scripts/auth-settings-runtime-proof.ts - claimed L4 exceeds observed L0
- test-l4-provider-mode: apps/platform-api/scripts/auth-settings-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/auth-settings-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/auth-settings-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/auth-settings-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/auth-settings-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/auth-settings-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/auth-settings-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-claim-overstated: apps/platform-api/scripts/backup-control-route-runtime-proof.ts - claimed L2 exceeds observed L1
- proof-command-failed: apps/platform-api/scripts/backup-local-runtime-proof.ts - proof command exited 1
- proof-claim-overstated: apps/platform-api/scripts/backup-local-runtime-proof.ts - claimed L4 exceeds observed L0
- test-l4-provider-mode: apps/platform-api/scripts/backup-local-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/backup-local-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/backup-local-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/backup-local-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/backup-local-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/backup-local-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/backup-local-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-command-failed: apps/platform-api/scripts/backup-restore-scripts-runtime-proof.ts - proof command exited 1
- proof-claim-overstated: apps/platform-api/scripts/backup-restore-scripts-runtime-proof.ts - claimed L4 exceeds observed L0
- test-l4-provider-mode: apps/platform-api/scripts/backup-restore-scripts-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/backup-restore-scripts-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/backup-restore-scripts-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/backup-restore-scripts-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/backup-restore-scripts-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/backup-restore-scripts-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/backup-restore-scripts-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-claim-overstated: apps/platform-api/scripts/billing-catalog-runtime-proof.ts - claimed L2 exceeds observed L1
- observability-proof-signal: apps/platform-api/scripts/billing-catalog-runtime-proof.ts - observability proof lacks captured trace/log/metric evidence
- proof-claim-overstated: apps/platform-api/scripts/billing-control-route-runtime-proof.ts - claimed L2 exceeds observed L1
- proof-claim-overstated: apps/platform-api/scripts/billing-provider-runtime-proof.ts - claimed L2 exceeds observed L1
- proof-claim-overstated: apps/platform-api/scripts/billing-readiness-route-runtime-proof.ts - claimed L2 exceeds observed L1
- proof-claim-overstated: apps/platform-api/scripts/browser-telemetry-provider-runtime-proof.ts - claimed L4 exceeds observed L1
- test-l4-provider-mode: apps/platform-api/scripts/browser-telemetry-provider-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/browser-telemetry-provider-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/browser-telemetry-provider-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/browser-telemetry-provider-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/browser-telemetry-provider-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/browser-telemetry-provider-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/browser-telemetry-provider-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-command-failed: apps/platform-api/scripts/caddy-local-routing-probe-runtime-proof.ts - proof command exited 1
- proof-claim-overstated: apps/platform-api/scripts/caddy-local-routing-probe-runtime-proof.ts - claimed L3 exceeds observed L0
- missing-before-after-state: apps/platform-api/scripts/caddy-local-routing-probe-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/caddy-local-routing-probe-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/caddy-local-routing-probe-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/caddy-local-routing-probe-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/caddy-local-routing-probe-runtime-proof.ts - L3+ proof requires an exercised failure path
- proof-command-failed: apps/platform-api/scripts/clamav-antivirus-runtime-proof.ts - proof command exited 1
- proof-claim-overstated: apps/platform-api/scripts/clamav-antivirus-runtime-proof.ts - claimed L4 exceeds observed L0
- test-l4-provider-mode: apps/platform-api/scripts/clamav-antivirus-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/clamav-antivirus-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/clamav-antivirus-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/clamav-antivirus-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/clamav-antivirus-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/clamav-antivirus-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/clamav-antivirus-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-claim-overstated: apps/platform-api/scripts/clickthrough-services-runtime-proof.ts - claimed L4 exceeds observed L1
- test-l4-provider-mode: apps/platform-api/scripts/clickthrough-services-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/clickthrough-services-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/clickthrough-services-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/clickthrough-services-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/clickthrough-services-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/clickthrough-services-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/clickthrough-services-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-claim-overstated: apps/platform-api/scripts/compliance-report-route-runtime-proof.ts - claimed L2 exceeds observed L1
- proof-claim-overstated: apps/platform-api/scripts/compliance-report-runtime-proof.ts - claimed L4 exceeds observed L1
- test-l4-provider-mode: apps/platform-api/scripts/compliance-report-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/compliance-report-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/compliance-report-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/compliance-report-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/compliance-report-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/compliance-report-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/compliance-report-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-command-failed: apps/platform-api/scripts/compose-environment-operation-runtime-proof.ts - proof command exited 1
- proof-claim-overstated: apps/platform-api/scripts/compose-environment-operation-runtime-proof.ts - claimed L4 exceeds observed L0
- test-l4-provider-mode: apps/platform-api/scripts/compose-environment-operation-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/compose-environment-operation-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/compose-environment-operation-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/compose-environment-operation-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/compose-environment-operation-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/compose-environment-operation-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/compose-environment-operation-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-claim-overstated: apps/platform-api/scripts/composed-provider-readiness-runtime-proof.ts - claimed L4 exceeds observed L1
- test-l4-provider-mode: apps/platform-api/scripts/composed-provider-readiness-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/composed-provider-readiness-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/composed-provider-readiness-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/composed-provider-readiness-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/composed-provider-readiness-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/composed-provider-readiness-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/composed-provider-readiness-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-claim-overstated: apps/platform-api/scripts/composed-provider-runtime-closure-proof.ts - claimed L2 exceeds observed L1
- proof-command-failed: apps/platform-api/scripts/credential-lifecycle-runtime-proof.ts - proof command exited 2
- proof-claim-overstated: apps/platform-api/scripts/credential-lifecycle-runtime-proof.ts - claimed L4 exceeds observed L0
- test-l4-provider-mode: apps/platform-api/scripts/credential-lifecycle-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/credential-lifecycle-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/credential-lifecycle-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/credential-lifecycle-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/credential-lifecycle-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/credential-lifecycle-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/credential-lifecycle-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-command-failed: apps/platform-api/scripts/dashboards-runtime-proof.ts - proof command exited 1
- proof-claim-overstated: apps/platform-api/scripts/dashboards-runtime-proof.ts - claimed L4 exceeds observed L0
- test-l4-provider-mode: apps/platform-api/scripts/dashboards-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/dashboards-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/dashboards-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/dashboards-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/dashboards-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/dashboards-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/dashboards-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-command-failed: apps/platform-api/scripts/data-governance-runtime-proof.ts - proof command exited 1
- proof-claim-overstated: apps/platform-api/scripts/data-governance-runtime-proof.ts - claimed L3 exceeds observed L0
- missing-before-after-state: apps/platform-api/scripts/data-governance-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/data-governance-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/data-governance-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/data-governance-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/data-governance-runtime-proof.ts - L3+ proof requires an exercised failure path
- proof-claim-overstated: apps/platform-api/scripts/data-portability-runtime-proof.ts - claimed L4 exceeds observed L1
- test-l4-provider-mode: apps/platform-api/scripts/data-portability-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/data-portability-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/data-portability-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/data-portability-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/data-portability-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/data-portability-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/data-portability-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-claim-overstated: apps/platform-api/scripts/data-residency-runtime-proof.ts - claimed L2 exceeds observed L1
- proof-command-failed: apps/platform-api/scripts/domain-identity-matrix-runtime-proof.ts - proof command exited 1
- proof-claim-overstated: apps/platform-api/scripts/domain-identity-matrix-runtime-proof.ts - claimed L4 exceeds observed L0
- test-l4-provider-mode: apps/platform-api/scripts/domain-identity-matrix-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/domain-identity-matrix-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/domain-identity-matrix-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/domain-identity-matrix-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/domain-identity-matrix-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/domain-identity-matrix-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/domain-identity-matrix-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-command-failed: apps/platform-api/scripts/email-sender-runtime-proof.ts - proof command exited 2
- proof-claim-overstated: apps/platform-api/scripts/email-sender-runtime-proof.ts - claimed L4 exceeds observed L0
- test-l4-provider-mode: apps/platform-api/scripts/email-sender-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/email-sender-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/email-sender-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/email-sender-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/email-sender-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/email-sender-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/email-sender-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-claim-overstated: apps/platform-api/scripts/entitlement-policy-chain-runtime-proof.ts - claimed L3 exceeds observed L1
- missing-before-after-state: apps/platform-api/scripts/entitlement-policy-chain-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/entitlement-policy-chain-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/entitlement-policy-chain-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/entitlement-policy-chain-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/entitlement-policy-chain-runtime-proof.ts - L3+ proof requires an exercised failure path
- proof-claim-overstated: apps/platform-api/scripts/entitlements-postgres-runtime-proof.ts - claimed L4 exceeds observed L1
- test-l4-provider-mode: apps/platform-api/scripts/entitlements-postgres-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/entitlements-postgres-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/entitlements-postgres-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/entitlements-postgres-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/entitlements-postgres-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/entitlements-postgres-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/entitlements-postgres-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-claim-overstated: apps/platform-api/scripts/entitlements-routes-runtime-proof.ts - claimed L4 exceeds observed L1
- test-l4-provider-mode: apps/platform-api/scripts/entitlements-routes-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/entitlements-routes-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/entitlements-routes-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/entitlements-routes-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/entitlements-routes-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/entitlements-routes-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/entitlements-routes-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-claim-overstated: apps/platform-api/scripts/entitlements-runtime-proof.ts - claimed L3 exceeds observed L1
- missing-before-after-state: apps/platform-api/scripts/entitlements-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/entitlements-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/entitlements-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/entitlements-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/entitlements-runtime-proof.ts - L3+ proof requires an exercised failure path
- proof-claim-overstated: apps/platform-api/scripts/environment-admin-bootstrap-runtime-proof.ts - claimed L3 exceeds observed L1
- missing-before-after-state: apps/platform-api/scripts/environment-admin-bootstrap-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/environment-admin-bootstrap-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/environment-admin-bootstrap-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/environment-admin-bootstrap-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/environment-admin-bootstrap-runtime-proof.ts - L3+ proof requires an exercised failure path
- proof-claim-overstated: apps/platform-api/scripts/environment-operations-runtime-proof.ts - claimed L4 exceeds observed L1
- test-l4-provider-mode: apps/platform-api/scripts/environment-operations-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/environment-operations-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/environment-operations-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/environment-operations-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/environment-operations-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/environment-operations-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/environment-operations-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-claim-overstated: apps/platform-api/scripts/environment-registry-runtime-proof.ts - claimed L4 exceeds observed L1
- test-l4-provider-mode: apps/platform-api/scripts/environment-registry-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/environment-registry-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/environment-registry-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/environment-registry-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/environment-registry-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/environment-registry-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/environment-registry-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-claim-overstated: apps/platform-api/scripts/event-bus-runtime-proof.ts - claimed L4 exceeds observed L1
- test-l4-provider-mode: apps/platform-api/scripts/event-bus-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/event-bus-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/event-bus-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/event-bus-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/event-bus-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/event-bus-runtime-proof.ts - L3+ proof requires an exercised failure path
- missing-real-local-substrate: apps/platform-api/scripts/event-bus-runtime-proof.ts - L4 proof requires real local substrate evidence
- proof-claim-overstated: apps/platform-api/scripts/event-redrive-runtime-proof.ts - claimed L4 exceeds observed L1
- test-l4-provider-mode: apps/platform-api/scripts/event-redrive-runtime-proof.ts - L4 TEST proof must use compose-local real local substrate evidence
- missing-before-after-state: apps/platform-api/scripts/event-redrive-runtime-proof.ts - L3+ proof requires before and after state snapshots
- missing-before-state: apps/platform-api/scripts/event-redrive-runtime-proof.ts - L3+ proof requires a before state snapshot
- missing-after-state: apps/platform-api/scripts/event-redrive-runtime-proof.ts - L3+ proof requires an after state snapshot
- missing-side-effect-evidence: apps/platform-api/scripts/event-redrive-runtime-proof.ts - L3+ proof requires asserted state diff and side-effect assertion
- missing-failure-path: apps/platform-api/scripts/event-redrive-runtime-proof.ts - L3+ proof requires an exercised failure path
