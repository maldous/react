# ADR-0066: Support administration and break-glass architecture

## Status

Accepted (2026-06-13, ADR-ACT-0269 — governance hardening; accepted on Matt's authority per the directive). The existing audited support-session usecase is the only delivered element. Break-glass approval workflow, host-origin escalation policy, tenant suspension/deletion/export, support desk (Zammad/Chatwoot), customer health signals, incident communications, and admin announcements are **NOT delivered** — they are Proposed sub-decisions. Host-origin escalation policy remains explicitly unresolved and is a named production blocker.

## Date

2026-06-13

## Decision owner

Architecture owner / operations / security

## Consulted

Support; operations; security; AI assistant (drafting, human review required).

## Context

An audited, short-lived support-session usecase exists (`POST /api/admin/support-session`, audited, time-boxed, scoped to one tenant — ADR-ACT-0187). Tenant provisioning is delivered. However there is no approval workflow gating support session creation, no host-origin escalation policy (deliberately deferred per bedrock hardening evidence), no tenant suspension, no tenant deletion, no tenant export, no support ticketing system, no customer-health signals, no incident communication surface, and no admin announcement mechanism. The Phase-0 ADR decision-quality assessment (ADR-ACT-0252) identified the host-origin escalation policy as explicitly unresolved, and the tenant-deletion coordination criteria as a key gap. This hardened version makes both explicit and adds testable acceptance criteria and proof requirements for each sub-decision.

## Decision (delivered)

**Support-session (ADR-ACT-0187):** time-boxed, audited, scoped to one tenant, operator-only (`platform.admin.access`). This is the only delivered element. It is the substrate on which the break-glass approval workflow (sub-decision 1) will be built.

## Decision (Proposed sub-decisions — NOT delivered)

### Sub-decision 1: Break-glass approval workflow (build)

Extend the existing support-session with a multi-step approval workflow on the Phase-5 event substrate (ADR-0059). A support-session request must be approved by a named second operator before the session token is issued. The approval workflow is durable (survives a restart), time-bounded (request expires if not approved within a configurable window), and audited at every transition (requested, approved, denied, expired, used, ended). The approved session is still time-boxed and scoped to one tenant. The approval workflow must use the same `DurableWorkflowPort` as other ADR-0063/0064 workflows when that port is available; in the interim, the Phase-5 Postgres outbox is sufficient for a two-step approval.

### Sub-decision 2: Host-origin escalation policy (policy decision — explicitly unresolved)

Host-origin escalation (a support operator accessing a tenant through the tenant's own FQDN host, not the operator console) is **deliberately deferred**. It was deferred in the bedrock hardening evidence because the policy (who may escalate, under what conditions, with what audit trail, and how the FQDN-based session is distinguished from a normal tenant login) has not been accepted. **This sub-decision must be resolved as a named policy in this ADR before any implementation begins.** The policy must cover: (a) the actor model (which operator roles may initiate host-origin escalation), (b) the approval requirement (single or dual operator), (c) the audit surface (how host-origin sessions are distinguished from normal logins in the audit trail), (d) the Keycloak realm boundary (does the operator token cross realm boundaries?), and (e) the host-origin detection mechanism (how the platform reliably identifies a support session originating from a tenant host). This policy is a production blocker; no code change for host-origin escalation may be merged before the policy sub-decision is recorded and accepted.

### Sub-decision 3: Tenant lifecycle — suspension, deletion, export (build)

Build the following tenant lifecycle transitions, in dependency order:

- **Suspension:** a suspended tenant cannot log in; sessions are invalidated; API keys are revoked; the tenant record is flagged `suspended`; suspension is reversible. Audited.
- **Export:** produce a full tenant data export (reusing ADR-0063 sub-decision 4, import/export) before deletion. Export is a prerequisite for deletion.
- **Deletion:** a soft-delete flag followed by a scheduled purge. Purge coordinates: (a) Postgres schema drop (RLS-scoped rows deleted, schema removed), (b) MinIO prefix deletion, (c) Keycloak realm deletion, (d) DSR purge (ADR-0063 sub-decision 3 — personal data rows). Deletion is blocked by an active legal hold (ADR-0064 sub-decision 4). Purge is audited at each step; partial purge is recorded and resumable. Deletion is **irreversible** — once all steps complete, the tenant cannot be recovered.

These three transitions are implemented in dependency order: suspension first (no external dependencies), export second (depends on ADR-0063 import/export), deletion last (depends on export + legal-hold + DSR-coordination).

### Sub-decision 4: Support desk — Zammad or Chatwoot (compose)

Compose **Zammad** or **Chatwoot** (both OSS, free local runners) as the support ticketing system. The choice between Zammad and Chatwoot is resolved at Phase-10 implementation time based on local runner resource footprint and API surface for tenant-tag enforcement. Either must run locally free under a permissive licence. The support desk is classified `shared-cross-environment` (per ADR-0056) only if: (a) tickets are tagged with the tenant identifier at creation and the tag is mandatory (cannot be omitted), (b) access control limits which operators can read tickets for a given tenant tag, (c) a retention policy is configured and proven, and (d) a leakage analysis (ADR-0056) confirms no cross-tenant ticket data is accessible. If the shared model cannot be proven safe, the support desk is `per-environment`.

**Rejected: built-in-only support tickets.** The volume and workflow requirements of a support desk (assignment, SLA, escalation, email threading) exceed what a built-in Postgres table can reasonably provide. A composed OSS tool is the right answer; the `SupportTicketPort` abstraction allows the implementation to be swapped.

### Sub-decision 5: Customer health signals, incident communications, announcements (build)

Build these three surfaces on existing substrates:

- **Customer health signals:** a `TenantHealthPort` aggregating the existing service-readiness probes (ADR-0055/ADR-0062) per tenant. Operators see a per-tenant health dashboard. No new data store required; health is derived from existing readiness signals.
- **Incident communications:** an operator surface to send a structured incident update to affected tenants, delivered via the Phase-6 notification substrate (ADR-0068). Incident communications are tenant-scoped, audited (`incident_comm.sent`), and never delivered to unaffected tenants.
- **Announcements:** an operator surface to send a platform-wide or per-tenant announcement via the Phase-6 notification substrate. Announcements are audited (`announcement.sent`).

### Alternatives considered

1. **Break-glass approval on the Phase-5 event substrate; host-origin policy deferred until policy is accepted (chosen).** The existing support-session is a proven substrate; adding an approval workflow on the outbox is the lowest-risk extension; host-origin escalation deferred until its policy is accepted closes the most dangerous gap.
2. **Host-origin escalation enabled immediately without a policy.** Rejected — the bedrock hardening evidence explicitly deferred this; a session that crosses realm boundaries without a defined actor model and audit surface is a privilege escalation risk.
3. **Zammad only (no Chatwoot spike).** Not fully rejected — Zammad is the primary candidate. Chatwoot is retained as a valid alternative because its API surface is simpler for tenant-tag enforcement. The choice is resolved at Phase-10.
4. **Built-in support tickets.** Assessed and rejected for full support desk use (volume, SLA, threading); a built-in minimal notes surface is acceptable for Phase 10 early work before the composed tool is proven.
5. **Tenant deletion without export.** Rejected — deletion is irreversible; an export is a mandatory prerequisite so that data can be recovered if the deletion was in error.
6. **Tenant deletion without legal-hold coordination.** Rejected — an active legal hold must block the purge step.
7. **Shared support desk without tenant-tag enforcement.** Rejected per ADR-0056 — cross-tenant ticket visibility is a data-isolation failure.

### Rejected alternatives (required)

- **Host-origin escalation without an accepted policy** — rejected: this is an explicitly named production blocker; no implementation may proceed.
- **Tenant deletion without a preceding export** — rejected: deletion is irreversible; export is the prerequisite.
- **Tenant deletion that does not coordinate DSR purge** — rejected: personal data rows must be purged as part of deletion per GDPR obligations.
- **Support desk shared across environments without tenant-tag mandatory at creation** — rejected per ADR-0056.
- **Suspension without session invalidation and API key revocation** — rejected: a suspended tenant must have no active access paths.
- **Incident communications sent to unaffected tenants** — rejected: communications are always tenant-scoped; broadcast to all tenants for a single-tenant incident is not permitted.
- **Customer health derived from fake or manually set readiness** — rejected per the repo's no-fake-readiness discipline; health signals must come from the same honest probes that drive `/api/org/platform/services/readiness`.

### Accepted decision

Accept sub-decisions 1, 3, 4, 5 with the dependency ordering stated above. Sub-decision 2 (host-origin escalation policy) is accepted as a named open question that must be resolved before implementation; it is not accepted as a policy. The support desk is Zammad (primary) or Chatwoot (valid alternative), resolved at Phase 10.

## Implementation phases

1. **Phase 8a — Tenant suspension + export:** `suspend` transition; export via ADR-0063 import/export port; `proof:tenant-suspend`, `proof:tenant-export`.
2. **Phase 8b — Legal hold coordination (ADR-0064):** hold check in deletion path; `proof:legal-hold` (owned by ADR-0064 but must be proven before Phase 8c).
3. **Phase 8c — Tenant deletion:** full purge coordination (Postgres + MinIO + Keycloak + DSR); `proof:tenant-delete` (proves all purge steps complete; proves hold blocks purge; proves cross-tenant impossibility).
4. **Phase 8d — Break-glass approval workflow:** approval step on Phase-5 outbox; two-operator approval; `proof:break-glass-approval`.
5. **Phase 10a — Support desk:** compose Zammad or Chatwoot; `SupportTicketPort`; tenant-tag enforcement; `proof:support-tickets`.
6. **Phase 10b — Customer health + incident comms + announcements:** `TenantHealthPort` on existing readiness probes; incident-comm and announcement surfaces on Phase-6 notification substrate; `proof:tenant-health`, `proof:incident-comms`, `proof:announcements`.
7. **Host-origin escalation policy:** when the policy sub-decision is accepted, a separate implementation phase is scheduled. No code before policy acceptance.

## Acceptance criteria

### Sub-decision 1 (break-glass approval)

- A support-session request creates an approval workflow event; a second operator approves it before the session token is issued; an unapproved request expires after the configured window; the approved session is time-boxed and scoped to one tenant; all transitions (requested, approved, denied, expired, used, ended) are audited; `proof:break-glass-approval` passes against live Postgres + event substrate.

### Sub-decision 2 (host-origin escalation policy)

- The policy document must be recorded in this ADR (as a named sub-decision) and accepted before any implementation; it must cover actor model, approval requirement, audit surface, realm boundary, and detection mechanism; `proof:host-origin-escalation` (to be defined at policy-acceptance time).

### Sub-decision 3 (tenant lifecycle)

- Suspension invalidates all active sessions and revokes API keys for the tenant; the suspended flag is set; suspension is reversible; all steps are audited; `proof:tenant-suspend` passes.
- An export produces a complete, RLS-scoped, encrypted tenant data archive in MinIO with a signed URL; `proof:tenant-export` passes.
- A deletion purge completes all steps (Postgres + MinIO + Keycloak + DSR) or records a partial purge for resumption; an active legal hold blocks the purge; the purge is irreversible once complete; `proof:tenant-delete` passes (proves all steps; proves hold blocks; proves cross-tenant data is not deleted).

### Sub-decision 4 (support desk)

- The composed OSS support desk starts locally free; tickets are tenant-tagged at creation (mandatory); cross-tenant ticket visibility is impossible; a retention policy is configured; a leakage analysis confirms the shared model is safe; `proof:support-tickets` passes.

### Sub-decision 5 (health / comms / announcements)

- Customer health signals are derived from existing honest readiness probes (no fake status); incident communications are delivered only to tenants in scope via the Phase-6 substrate; announcements are audited; `proof:tenant-health`, `proof:incident-comms`, `proof:announcements` pass.

## Proof requirements

`proof:break-glass-approval` (live Postgres + event substrate — approval workflow, expiry, audit), `proof:tenant-suspend` (live Postgres — session invalidation, API key revocation, reversibility, audit), `proof:tenant-export` (live MinIO + Postgres — RLS-scoped, encrypted, signed URL), `proof:tenant-delete` (live Postgres + MinIO + Keycloak — all purge steps, hold blocks, irreversibility, audit), `proof:support-tickets` (live composed tool — tenant tag mandatory, cross-tenant impossible, retention configured), `proof:tenant-health` (live readiness probes — honest signals, no fake status), `proof:incident-comms` (live Phase-6 substrate — tenant-scoped, audited), `proof:announcements` (live Phase-6 substrate — audited). All proofs SKIP honestly when a prerequisite is unavailable; a skipped proof is not a passed proof. No capability advances in the registry without its named proof.

## Production blockers

- **Host-origin escalation policy is explicitly unresolved** — no implementation may proceed until the policy (actor model, approval, audit surface, realm boundary, detection mechanism) is accepted in this ADR.
- **Break-glass approval workflow requires Phase-5 event substrate** (delivered) and is not yet built.
- **Tenant deletion requires ADR-0063 DSR/import-export** (not delivered) and **ADR-0064 legal hold** (not delivered); deletion without these is irreversible with no hold check and no recovery path.
- **Support desk requires a leakage analysis** (ADR-0056) before the shared model is confirmed.
- **Tenant suspension** has no upstream blockers but is not yet built.
- No customer health dashboard, incident communication surface, or announcement surface exists today.

## Consequences

Positive: the break-glass approval workflow closes the most critical gap (unilateral privileged access) without requiring host-origin escalation; tenant suspension is the safest first lifecycle step (reversible); the support desk composition behind a port allows swapping Zammad for Chatwoot without a code change.

Negative: tenant deletion has the deepest prerequisite chain (ADR-0063 import/export + ADR-0064 legal hold + DSR coordination); host-origin escalation remains blocked on a policy decision with no timeline; the composed support desk adds operational complexity.

Neutral / operational: all lifecycle transitions are audited; holds gate deletion; communications use the existing Phase-6 notification substrate; customer health is derived from existing honest probes, not a new data store.

## Validation / evidence

Evidence level: High (privileged access + irreversible deletion). The only existing proof is `support-mode unit tests` (ADR-ACT-0187). All other proofs are to be created at Phase-8/10 implementation time. Evidence location: `docs/evidence/platform/` (per sub-decision). No sub-decision may be claimed delivered without its named proof and evidence document.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md`: ADR-ACT-0251 (original delivery tracking), ADR-ACT-0269 (this hardening). Host-origin escalation policy: a separate action item is required when a policy proposal is ready. Phase-10 support desk spike (Zammad vs Chatwoot) to be added when Phase 10 is scheduled.

## References

ADR-0036, ADR-0040, ADR-0049, ADR-0053, ADR-0054, ADR-0056, ADR-0059, ADR-0063, ADR-0064, ADR-0068, ADR-ACT-0187.

## Notes

Accepted on 2026-06-13 (ADR-ACT-0269) on Matt's authority per the directive. The only delivered element is the audited support-session usecase (ADR-ACT-0187). Host-origin escalation policy is a named open question — the most important single gate before any escalation code is written. Tenant deletion is the highest-risk operation and has the deepest dependency chain; it must not be implemented until ADR-0063 import/export, ADR-0064 legal hold, and DSR coordination are all delivered. The support desk is Zammad (primary) or Chatwoot (valid alternative); neither is a default until the Phase-10 spike result is recorded.
