# V1 Completion Programme (standalone)

Reconciliation is **not** gap-free (see `zero-gap-reconciliation.json`, `gap-report.md`). This
programme is split into three honest classes:

- **§A Semantic completions (V1C-01..25 + package decisions)** — design/build/extension; these are
  **branch-cut blockers**. Each lists source ADR/action, exact work, code paths, contracts/routes,
  tests/proofs, UI semantic definition, stop condition, and V2 assets produced.
- **§B Execution-only (P-EXEC)** — resolved dispositions, zero discovery; mechanical.
- **§C Deprecated package removals (PKG-01..10)** — proven-zero-consumer scaffolds, `delete-after-proof`.

Audited V1 commit: `918cd148569f6473eeaa58284933abdc0fe5bafe`. Freeze commit: `{{PINNED_V1_COMMIT}}`
(pinned at cut time, runbook §1). **No package is deleted by this change** (per instruction).

---

## §A — Semantic completions (branch-cut blockers)

### Identity & access

**V1C-01 — Tenant groups admin UI.**

- Source: ADR-0021, ADR-0058, ADR-ACT-0234.
- Work: build the missing `/admin/groups` slice over the existing, proven API; no behaviour change.
- Code paths: `apps/react-enterprise-app/src/features/groups/`; reuse `apps/platform-api` `/api/org/groups*`.
- Contracts/routes: `/api/org/groups*` (present); add TanStack Query hooks + routeTree entry.
- Tests/proofs: carry groups unit tests; add MSW + a11y + Playwright journey for the new slice.
- UI semantics: list/create/update/delete groups; member assignment; permission `tenant.groups.*`.
- Stop: `/admin/groups` reachable, permission-gated, journey + a11y green.
- V2 assets: groups admin slice as AI-UI semantic source.

**V1C-02 — Sub-organisations admin UI.**

- Source: ADR-0021, ADR-0058, ADR-ACT-0234.
- Work: `/admin/sub-organisations` slice over proven `/api/org/sub-organisations*`.
- Code paths: `apps/react-enterprise-app/src/features/sub-organisations/`.
- Contracts/routes: `/api/org/sub-organisations*` (present).
- Tests/proofs: carry sub-org unit tests; add slice MSW + a11y + journey.
- UI semantics: CRUD sub-orgs; hierarchy; `tenant.suborgs.*`.
- Stop: slice reachable + gated; journey + a11y green.
- V2 assets: sub-org admin slice.

**V1C-03 — ABAC / Policy Decision Point (Phase 2 quota enforcement).**

- Source: ADR-0058, ADR-ACT-0242.
- Work: extend the entitlement PEP from UMA-scope checks to a general attribute model; wire real
  quota enforcement (Phase 2) into the BFF pipeline after permission + entitlement.
- Code paths: `apps/platform-api/src/server` pipeline PEP; `/api/auth/settings/resource-policies`.
- Contracts/routes: existing resource-policies route; extend policy schema.
- Tests/proofs: carry `authorize-resource` + `proof:entitlement-policy-chain`; add attribute-model + quota-enforcement proofs.
- UI semantics: auth-settings policy editor (attributes + quota rules).
- Stop: attribute decisions + quota enforcement proven end-to-end; no production gap.
- V2 assets: complete PEP as semantic source.

**V1C-04 — Delegated administration roles (net-new; needs ADR).**

- Source: ADR-0058, ADR-ACT-0242 (status deferred).
- Work: author a V1 ADR (delegation model: scope, grant/revoke, audit), then build port/adapter/
  contract/route/UI. No V1 asset to reuse — this is design-then-build.
- Code paths: new `apps/platform-api` delegation usecases + `IdentityRepositoryPort` extension; `/admin/members` delegation surface.
- Contracts/routes: define `/api/org/delegations*` (to build).
- Tests/proofs: new unit + substrate + journey; delegation grant/revoke audit proof.
- UI semantics: assign delegated admin scopes to members; revoke; audit trail.
- Stop: ADR Accepted; route+UI+audit delivered; proof green.
- V2 assets: delegation capability + its first ADR.

**V1C-05 — Support-mode / break-glass approval workflow.**

- Source: ADR-0066, ADR-ACT-0251.
- Work: add the approval workflow + host-origin escalation that the proven `POST /api/admin/support-session` core lacks.
- Code paths: `apps/platform-api` support-session usecase; new approval state machine.
- Contracts/routes: extend support-session route with approve/deny; audit.
- Tests/proofs: carry support-mode unit tests; add approval-workflow proof.
- UI semantics: request → approve → time-boxed enter → audited exit.
- Stop: approval workflow proven; break-glass fully audited.
- V2 assets: complete support-mode capability.

### Authentication

**V1C-06 — Claim mapping admin UI completion.**

- Source: ADR-0046, ADR-ACT-0220.
- Work: complete the partial `/admin/auth` mapping editor. Live real-IdP mapping proof is
  **externally blocked** (ADR-ACT-0220) and is carried as the not-applicable-final
  `Real IdP login simulation` capability — it is NOT a buildable gap.
- Code paths: `apps/react-enterprise-app/src/features/auth/` mapping editor; `/api/auth/settings/idps/:alias/mapping`.
- Contracts/routes: existing mapping route.
- Tests/proofs: carry `oidc-mapping` unit tests; add mapping-editor MSW + a11y.
- UI semantics: claim → attribute, group/role mapping rules editor.
- Stop: mapping UI complete + gated; unit proof green (live IdP accepted external).
- V2 assets: mapping editor slice.

**V1C-07 — MFA lockout/recovery surface + MFA-required E2E.**

- Source: ADR-0042, ADR-ACT-0158.
- Work: expose account lockout/recovery; land the deferred MFA-required login E2E.
- Code paths: `apps/platform-api` `/api/auth/settings/mfa,/session`; lockout/recovery handlers.
- Contracts/routes: extend mfa/session routes with lockout/recovery.
- Tests/proofs: `proof:auth-settings`; add MFA-required login E2E (ADR-ACT-0158).
- UI semantics: MFA + session + lockout/recovery tabs.
- Stop: lockout/recovery exposed; MFA-required E2E green.
- V2 assets: complete MFA/session surface.

### Configuration

**V1C-08 — Branding + theming completion.**

- Source: ADR-0029, ADR-ACT-0237.
- Work: complete the partial branding capability flagged partial in the readiness registry.
- Code paths: `/admin/config` branding; `GET /api/theme`; theme adapter.
- Contracts/routes: theme route; branding config schema.
- Tests/proofs: carry local-caddy theme proof; add branding-complete proof + a11y.
- UI semantics: logo/colour/theme editor with live preview.
- Stop: branding registry status no longer partial; proof green.
- V2 assets: branding editor slice.

**V1C-09 — Custom domains canonical/TLS cutover.**

- Source: ADR-0048, ADR-0033, ADR-ACT-0232.
- Work: prove the canonical-redirect cutover in the self-contained stack. Public DNS verification is
  externally limited; prove what is provable locally (Caddy routing, canonical redirect).
- Code paths: `/admin/domains`; `TenantDomainPort`; `DnsChallengeAdapter`.
- Contracts/routes: `/api/org/domains*`.
- Tests/proofs: carry `proof:tenant-domains`, `proof:tenant-domain-canonical`; add canonical-cutover redirect proof.
- UI semantics: domain add → verify → activate → set canonical.
- Stop: canonical cutover redirect proven locally; DNS limit documented.
- V2 assets: domains slice + cutover proof.

### Entitlements & billing

**V1C-10 — Product catalog / plans / prices (billing engine, net-new).**

- Source: ADR-0057, ADR-ACT-0241. (Port/adapter corrected to `n/a (net-new)` — the prior
  `ObservabilityPort/Loki` was a copy-paste error.)
- Work: design + build the billing catalog domain on the named permission/audit placeholders.
- Code paths: new `apps/platform-api` billing usecases + `BillingPort` + Postgres adapter; `/admin/billing`.
- Contracts/routes: define `/api/admin/billing/catalog*`, `/api/org/billing*`.
- Tests/proofs: new unit + substrate + routes proof.
- UI semantics: catalog/plan/price CRUD (operator) + tenant read.
- Stop: catalog engine delivered + proven.
- V2 assets: billing catalog capability.

**V1C-11 — Subscriptions / invoices / payments / dunning (net-new).**

- Source: ADR-0057, ADR-ACT-0241.
- Work: build subscription + invoice + dunning logic on the billing engine (V1C-10). Live payment
  capture uses an external paid provider — that **live proof is external**; prove ledger/dunning
  logic locally with a stub provider.
- Code paths: billing usecases; immutable billing ledger; webhook ingestion.
- Contracts/routes: `/api/org/billing/subscriptions*,/invoices*`.
- Tests/proofs: ledger + dunning unit/substrate; stub-provider proof (external capture documented).
- UI semantics: subscription state, invoices, payment methods, dunning timeline.
- Stop: ledger + dunning proven; external capture limit documented.
- V2 assets: subscription/billing capability.

### Data platform

**V1C-12 — PITR / retention / legal hold / residency (net-new).**

- Source: ADR-0064, ADR-0063, ADR-ACT-0248.
- Work: build PITR config, retention policy engine, legal-hold flags, residency tagging.
- Code paths: new ops usecases + Postgres/MinIO adapters; `/admin/data`.
- Contracts/routes: `/api/admin/data/retention*,/legal-hold*`.
- Tests/proofs: retention + legal-hold + residency proofs; restore drill.
- UI semantics: retention rules, legal-hold toggle, residency selector.
- Stop: machinery delivered + proven.
- V2 assets: data-lifecycle capability.

**V1C-13 — Data governance: catalog/lineage/classification/PII/DSR (net-new).**

- Source: ADR-0063, ADR-ACT-0247. (Port/adapter corrected to `n/a (net-new)`.)
- Work: build catalog, lineage, PII discovery/classification, and DSR/GDPR workflow.
- Code paths: new governance usecases + adapters; `/admin/governance`.
- Contracts/routes: `/api/admin/governance/*`, tenant DSR endpoints.
- Tests/proofs: DSR fulfilment audit proof; classification proof.
- UI semantics: catalog browse, DSR request → fulfil, classification labels.
- Stop: DSR workflow + catalog delivered + proven.
- V2 assets: governance capability.

**V1C-14 — Tenant data import/export (net-new).**

- Source: ADR-0063, ADR-ACT-0247.
- Work: build export (and import) pairing with tenant deletion/portability.
- Code paths: export usecase + StoragePort; `/admin/data`.
- Contracts/routes: `/api/org/data/export`, `/import`.
- Tests/proofs: export-audit proof; round-trip proof.
- UI semantics: request export → download; import upload.
- Stop: export/import delivered + audited.
- V2 assets: data portability capability.

**V1C-15 — Object storage file CRUD / quotas / lifecycle / AV.**

- Source: ADR-0049, ADR-0064, ADR-ACT-0223.
- Work: extend the proven readiness-only storage to file CRUD API/UI, quotas, lifecycle, AV scan, legal hold.
- Code paths: `apps/platform-api` storage usecases; `StoragePort`/`MinioStorageAdapter`; `/admin/storage`.
- Contracts/routes: add `/api/org/storage/objects*` CRUD; quota routes.
- Tests/proofs: carry `proof:tenant-storage`; add file-CRUD + quota + AV proofs.
- UI semantics: object browser, upload/download/delete, quota, lifecycle rules.
- Stop: file CRUD + quotas delivered + proven (live MinIO).
- V2 assets: storage browser capability.

### Events & workflow

**V1C-16 — Workflow engine + approvals.**

- Source: ADR-0059, ADR-ACT-0262.
- Work: build the workflow engine + approval workflow + visibility on the proven event substrate.
  (Built-in scheduled jobs are already delivered separately — do not rebuild.)
- Code paths: `apps/platform-api` workflow usecases on `EventBusPort`/`JobRunnerPort`; `/admin/workflows`.
- Contracts/routes: define `/api/admin/workflows*`.
- Tests/proofs: workflow transition audit proof; approval proof.
- UI semantics: workflow list/state, approve/deny, transitions audit.
- Stop: engine + approvals + visibility delivered + proven.
- V2 assets: workflow capability.

### Observability & ops

**V1C-17 — Metrics + traces backend + dashboards.**

- Source: ADR-0062, ADR-0020, ADR-ACT-0261.
- Work: add the metrics/trace backend + dashboards behind the OTEL collector that already ingests.
- Code paths: `/admin/observability`; `ObservabilityPort`; Tempo/Prometheus wiring.
- Contracts/routes: observability readiness + signal routes.
- Tests/proofs: carry `observability-smoke`, `proof:tenant-observability`; add metrics/trace backend proof.
- UI semantics: metrics/trace status + dashboard links.
- Stop: backend + dashboards delivered + proven.
- V2 assets: metrics/trace surface.

### Security & governance

**V1C-18 — Dependency scanning as a hard gate.**

- Source: ADR-0016, ADR-ACT-0247.
- Work: promote dependency scanning to a hard CI gate (Sonar + semgrep + gitleaks are already delivered).
- Code paths: CI config; `make` security gate.
- Contracts/routes: n/a (CI).
- Tests/proofs: `semgrep:gate`; add dependency-scan gate proof.
- UI semantics: n/a.
- Stop: dependency scan is a hard, failing gate.
- V2 assets: hardened CI security gate.

**V1C-19 — Compliance reports / access reviews / evidence packs.**

- Source: ADR-0063, ADR-ACT-0247.
- Work: build compliance report generation + access/role review workflow over the proven audit read model.
- Code paths: new compliance usecases; `/admin/compliance`.
- Contracts/routes: define `/api/admin/compliance/reports*,/reviews*`.
- Tests/proofs: review-completion audit proof; report-generation proof.
- UI semantics: generate report, run access review, export evidence pack.
- Stop: reports + reviews delivered + audited.
- V2 assets: compliance capability.

### Developer platform

**V1C-20 — Developer portal / SDK gen / sandbox.**

- Source: ADR-0065, ADR-0065, ADR-ACT-0250, ADR-ACT-0257.
- Work: build the external portal + SDK generation + sandbox/test mode. (Rate limiting and the
  OpenAPI drift hard gate are already delivered separately — do not rebuild.)
- Code paths: portal app/feature; SDK generator under `tools/`.
- Contracts/routes: portal BFF routes; existing `openapi.json` (drift gate already enforced).
- Tests/proofs: portal journey; SDK-gen proof.
- UI semantics: API docs portal, key management, sandbox console.
- Stop: portal + SDK + sandbox delivered + proven.
- V2 assets: developer portal capability.

### Support / admin

**V1C-21 — Tenant lifecycle suspend / delete / export.**

- Source: ADR-0066, ADR-0063, ADR-ACT-0251.
- Work: extend proven provision-only lifecycle to suspend, delete (coordinating data + storage +
  realm + DSR), and export.
- Code paths: `apps/platform-api` tenant lifecycle usecases; `/admin/tenants`.
- Contracts/routes: extend `/api/admin/tenants` with suspend/delete/export.
- Tests/proofs: carry provisioning tests; add suspend/delete/export coordination proofs.
- UI semantics: tenant lifecycle actions with confirmation + audit.
- Stop: full lifecycle delivered + proven; deletion coordinates all subsystems.
- V2 assets: tenant lifecycle capability.

**V1C-22 — Support tickets / customer health / announcements (net-new).**

- Source: ADR-0066, ADR-ACT-0251.
- Work: build ticketing, customer health, comms/announcements.
- Code paths: new support usecases; `/admin/support`.
- Contracts/routes: define `/api/admin/support/*`.
- Tests/proofs: support-action audit proof.
- UI semantics: ticket list/detail, health dashboard, announcement composer.
- Stop: ticketing + health + announcements delivered + proven.
- V2 assets: support capability.

### Foundation

**V1C-23 — Service catalog + provider integration generalisation.**

- Source: ADR-0055, ADR-ACT-0239.
- Work: generalise the static catalog-v2 seam + provider registry into the no-mock-in-production
  invariant fully (beyond the static seed).
- Code paths: `apps/platform-api` service-catalog; provider registry; `/admin/platform`.
- Contracts/routes: `GET /api/platform/service-catalog`; provider readiness.
- Tests/proofs: carry `proof:service-catalog-registry`; add generalisation proof.
- UI semantics: catalog browse + provider lifecycle.
- Stop: full generalisation delivered + proven.
- V2 assets: service-catalog capability.

**V1C-24 — Tenant canonical domain public cutover.**

- Source: ADR-ACT-0232.
- Work: prove public canonical cutover + redirects (local routing already proven). Public DNS portion
  is externally limited; prove the redirect/cutover logic in the self-contained stack.
- Code paths: `TenantDomainPort`; `/api/org/domains/canonical`.
- Contracts/routes: canonical route (present).
- Tests/proofs: carry `proof:tenant-domain-canonical`; add public-cutover redirect proof.
- UI semantics: set/unset canonical with redirect preview.
- Stop: cutover/redirect proven; DNS limit documented.
- V2 assets: canonical-domain cutover proof.

**V1C-25 — i18n React provider/hook + message migration (hard gate).**

- Source: ADR-0026.
- Work: finish the React provider/hook (currently a bootstrap placeholder in
  `packages/i18n-runtime/src/react.ts`) and the API/auth/validation message migration, then promote
  i18n validation to a hard gate.
- Code paths: `packages/i18n-runtime/src/react.ts`; API/auth message sites.
- Contracts/routes: n/a; `tools/architecture/validate-i18n`.
- Tests/proofs: `validate-i18n`; add provider/hook + migration proofs.
- UI semantics: i18n is the V2 UI-text semantic contract.
- Stop: provider/hook + message migration complete; i18n is a hard gate.
- V2 assets: complete i18n runtime + gate.

### Open package decision

**V1C-PKG-CONFIG — config-runtime fate.**

- Source: ADR-ACT-0289 (explicitly deferred), ADR-0006.
- Work: decide a typed composition-root config object (validation + secret handling review); do NOT
  treat the ~122 scattered `process.env` reads as canonical. Then EITHER keep `config-runtime` as the
  canonical V2 `runtime/config` package (deprecated status removed + full proof) OR remove it and
  supersede with the typed config object.
- Code paths: `packages/config-runtime`; composition root in `apps/platform-api`.
- Contracts/routes: n/a.
- Tests/proofs: config validation + secret-handling proof.
- Stop: decision recorded in an ADR; package kept-canonical-with-proof or removed; `v2-target-tree.txt`
  `runtime/config` line reflects the outcome.
- V2 assets: typed config contract; resolved package fate.

---

## §B — Execution-only (zero discovery)

**P-EXEC-1.** Regenerate the 179 `regenerate` artefacts via tooling (`make readmes`, orchestrator
`all --strict`, SBOM build); never hand-edit.
**P-EXEC-2.** Git-move the 19 `git-move` files (`git mv`, `git log --follow` proves history).
**P-EXEC-3.** Apply 104 `refactor-behind-contract` + 51 `replace-retain-contract` migrations behind
frozen `retainedInterfaces`; protecting tests carried/retargeted/promoted (per `v2-test-proof-map.json`).
**P-EXEC-4.** Execute the 1 split + 1 merge (path-map) and 42 command merges (`v2-command-map.json`).
**P-EXEC-5.** Archive the 174 `archive-evidence` records into the V2 historical area (no active gate).
**P-EXEC-6.** Retire the 12 retired tests (10 are the deprecated-package scaffold smoke tests; each has
a `retirementJustification`).

---

## §C — Deprecated package removals (delete-after-proof; NOT executed here)

All 10 are zero-consumer, deprecated (ADR-0006 active→deprecated, ADR-ACT-0289), now
`delete-after-proof` in the path-map and removed from `v2-target-tree.txt`. Each removal is gated on an
orchestrator strict run proving zero `@platform/<pkg>` consumers. Removal review date 2026-12-18.

| Action | Package               | Superseded by                                                                                                                        |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| PKG-01 | domain-core           | stdlib/typed-package helpers (no replacement package)                                                                                |
| PKG-02 | access-control        | authorisation-runtime + adapters-keycloak                                                                                            |
| PKG-03 | feature-workflow      | none (speculative, no consumer)                                                                                                      |
| PKG-04 | profile-configuration | application-local profile port (apps/platform-api)                                                                                   |
| PKG-05 | security-auth         | authorisation-runtime + adapters-keycloak                                                                                            |
| PKG-06 | queue-runtime         | application-local queue/event port (USF event-bus)                                                                                   |
| PKG-07 | search-runtime        | application-local SearchPort + PostgresFtsSearchAdapter                                                                              |
| PKG-08 | notification-runtime  | application-local NotificationTransportPort + transport adapters                                                                     |
| PKG-09 | worker-runtime        | USF event-bus + workers                                                                                                              |
| PKG-10 | observability         | platform-logging + platform-observability + platform-runtime-context + platform-errors split (ObservabilityPort abandoned, ADR-0020) |

Per-package removal steps (each): orchestrator strict zero-consumer proof → loader-alias cleanup →
import-boundary-row cleanup → `tsconfig.packages.json` reference cleanup → dependency-manifest cleanup
→ package-directory `git rm` → regenerated inventory/CODEMAPS. Stop: package gone, gate green,
reconciliation re-run still consistent.

---

### Global stop condition for declaring V1 complete

All §A completions delivered + proven; all §B executed; all §C removed after proof; `make all`
(authoritative ladder incl. Sonar absolute-zero gate) green; orchestrator strict pass; zero
`delete-after-proof` items remaining undeleted; `npm run v2:readiness --strict` exits `0`.
