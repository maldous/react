# ADR-0058: Policy decision point, entitlements, and delegated administration

## Status

Proposed — hardened to decision quality; implementation-ready for Phase 1 (ADR-ACT-0253). Formal acceptance pending human architecture review.

## Date

2026-06-13 (hardened 2026-06-13, ADR-ACT-0253)

## Decision owner

Architecture owner / security

## Consulted

Security; engineering; product owner; AI assistant (drafting + option comparison, human review required).

## Context

Authorization today uses Keycloak Authorization Services (UMA 2.0) as a Policy Enforcement Point in the BFF pipeline, backed by the real `authorisation-runtime` package, with route-level resource + scope metadata. Groups and sub-organisations exist API-only; delegated admin is deferred; there is no entitlement engine and no general attribute-policy model. The USF needs a single, decision-quality model that says **what each access-control concept means, in what order they evaluate, and how they fail** — before the entitlement substrate (Phase 1) is built. This ADR is the policy half of the Phase 1 spine (the catalog half is ADR-0055).

## The four concepts (authoritative definitions)

These are distinct and must never be conflated:

- **Entitlements** answer **"what is this tenant allowed to use?"** — plan/contract-level capability grants, tenant-scoped, assigned by system operators.
- **Permissions** answer **"who within the tenant may perform an action?"** — RBAC roles/scopes for actors inside a tenant.
- **Policy** answers **"under what runtime conditions is this action allowed?"** — attribute/condition checks (resource ownership, state, context) at decision time.
- **Quota** answers **"how much of the entitled capability remains available?"** — counters/limits derived from entitlement (enforcement is **Phase 2**, ADR-0057; only a hook exists in Phase 1).

A feature flag is **not** an entitlement. A flag toggles rollout/behaviour; an entitlement is a contractual grant gating access. Entitlement checks are server-authoritative; flags are not access control.

## The evaluation chain

Every protected BFF operation evaluates in this fixed order, **deny-by-default** at each step:

```text
session            → is there a valid authenticated session?
  → tenant context → which tenant, resolved server-side from host authority?
    → route scope  → does the route's required resource/umaScope apply?
      → permission → does the actor hold the RBAC permission (incl. delegated grants)?
        → entitlement → is the tenant entitled to this capability?
          → policy   → do runtime conditions (UMA/attribute) permit it?
            → quota  → is remaining quota > 0?  (Phase 2; Phase 1 = pass-through hook)
```

The first failing step denies the request with a typed `platform-errors` error and the appropriate status (401 no session, 403 permission/entitlement/policy, 429 quota). Order matters: permission before entitlement (don't reveal entitlement state to an unauthorised actor); entitlement before policy (don't run attribute evaluation for a capability the tenant cannot use); quota last (only meter what is otherwise allowed).

## RBAC boundary

RBAC (ADR-0021) owns **who within a tenant** may act: tenant-admin/manager/member/viewer roles → permission scopes (`tenant.members.*`, `tenant.config.*`, …). Keycloak realm roles are the source. RBAC does not express tenant-level grants (that is entitlements) or runtime conditions (that is policy).

## ABAC / PDP boundary

Policy owns **runtime conditions**: resource ownership, resource state, request context. The Policy Decision Point evaluates these. Today the PDP is Keycloak UMA (resource + scope decisions via `authorisation-runtime`). Policy sits **after** permission + entitlement in the chain and can only further restrict, never widen, what those allow.

## Keycloak UMA — the current path (kept)

Keycloak UMA 2.0 remains the PDP. The BFF pipeline is the PEP: route metadata declares `resource` + `umaScope`; `authorisation-runtime` requests a decision; deny-by-default on any non-permit. This is real and proven (`authorize-resource` tests) and is not replaced.

## When OPA / Cedar would be justified

Introduce an external PDP (OPA or a Cedar-compatible engine) **only** when a concrete attribute-policy requirement is proven that UMA cannot express (e.g. rich relationship/ABAC rules, cross-resource conditions, policy-as-code with external authoring). It would then be integrated **behind a `PolicyDecisionPort`** as one adapter among UMA — not bolted on route-side. Absent a proven need, adding OPA/Cedar is rejected (premature PDP sprawl).

## Entitlement checks versus permission checks

A permission check asks "does this actor hold this scope?" (RBAC). An entitlement check asks "is this tenant granted this capability?" (plan/contract). Both must pass. A tenant-admin (full permissions) still cannot use a capability the tenant is not entitled to; a member with an entitled tenant still cannot act without the permission. Both are server-side; neither is inferable by React.

## Delegated admin role model

Delegated administration (build) lets a tenant-admin grant **scoped** admin rights to other members via Keycloak fine-grained admin + custom scope mapping, fully audited. A delegated grant is a subset of the granter's own permissions (no privilege escalation); it is tenant-scoped, revocable, and time-boundable. Delegated admin extends _permissions_ only — it can never grant _entitlements_ (see limits) and can never exceed the tenant's entitled scope. Builds on `groups` (promoted to delivered UI) and the policy chain.

## Support-mode relationship

Operator break-glass (ADR-0066, `support-mode-breakglass`) is a **separate, system-operator** path, not delegated admin. It is time-boxed, audited, and enters a tenant under `platform.admin.access` with resource `platform:support`. Support-mode is subject to the same chain (session → … → policy) but originates from the operator host authority, not a tenant role, and never grants or alters entitlements.

## Policy audit model

Every authorization-relevant change and every privileged decision is audited (extends ADR-0040): permission/role change, delegated grant/revoke, entitlement assign/remove (system-operator only), support-session enter/exit, and policy denials where security-relevant. Audit is written before the effect (audit-before-change, CLAUDE.md); if the audit write fails, the action does not proceed. Audit metadata never contains secrets.

## Tenant-admin self-service limits

A tenant-admin **may**: manage members/roles/groups within their tenant (subject to permissions), read their tenant's assigned entitlements **if permitted** (`tenant.entitlements.read`), and manage config/auth/domains they own. A tenant-admin **may not**: grant or modify entitlements for their own (or any) tenant, exceed their own permission set when delegating, or see `global_only`/cross-tenant data. **Entitlement assignment is a system-operator action only** — a tenant cannot self-grant what it is allowed to use.

## Route-scope interaction

Routes declare `resource` + `umaScope` (existing) and, for capability-gated routes, an **entitlement key**. The pipeline reads this metadata and runs the chain. Entitlement gating is declared as route metadata + checked centrally in the pipeline — never as ad-hoc, route-local `if` logic without registry backing.

## Deny-by-default behaviour

Absence is denial at every step: no session → deny; no resolved tenant → deny; no permission → deny; **no entitlement → capability unavailable**; no explicit policy permit → deny; (Phase 2) no remaining quota → deny. Removing an entitlement immediately blocks access on the next request. There is no implicit allow.

## Failure model

- **Authz infrastructure unavailable** (Keycloak/PDP down): **fail closed** (deny), surface a typed error, never fall through to allow.
- **Entitlement store unavailable**: fail closed for entitlement-gated capabilities.
- **Quota backend unavailable** (Phase 2): policy decides fail-open vs fail-closed per capability; Phase 1's pass-through hook is a no-op that must not claim enforcement.
- All failures produce typed `platform-errors` errors (no raw `Error`), are logged via `platform-logging`, and never leak secrets or internal state to the client.

## Decision

### Alternatives considered

1. **Keep Keycloak UMA as PDP; add a build-it entitlement engine + a `PolicyDecisionPort` seam; delegated admin via Keycloak fine-grained admin (chosen).**
2. **Adopt OPA/Cedar now as the general PDP.** Powerful policy-as-code, but no proven attribute-policy need yet; adds a service + authoring model prematurely.
3. **Model entitlements as feature flags.** Reuses existing flags, but flags are not contractual access control, are not audited as grants, and blur the four concepts — explicitly wrong.
4. **Enforce in the UI / per-route ad-hoc checks.** Fast, but unsafe (client-inferable) and unmaintainable (no registry backing).

### Rejected alternatives

- (2) OPA/Cedar now — rejected until a concrete attribute-policy need is proven; the `PolicyDecisionPort` keeps the door open without rework.
- (3) Flags-as-entitlements — rejected; flags ≠ entitlements.
- (4) UI/ad-hoc enforcement — rejected; the BFF owns all checks.

### Accepted decision

Keep Keycloak UMA as the PDP behind a `PolicyDecisionPort`. Build a server-authoritative entitlement engine (tenant-scoped grants, system-operator assigned, audited). Enforce the fixed evaluation chain centrally in the BFF pipeline, deny-by-default, fail-closed. Deliver delegated admin via Keycloak fine-grained admin (permissions only, subset of granter, audited). Quota is a Phase-1 hook only; real enforcement is Phase 2.

### This ADR explicitly rejects

- **Feature flags as entitlements** — flags are rollout/behaviour, not contractual access control.
- **UI-only permission enforcement** — React cannot be the authority; all checks are server-side in the BFF.
- **Ad-hoc route-local policy logic without registry backing** — gating is declared as route metadata + evaluated centrally.
- **Adding OPA/Cedar before a concrete attribute-policy need exists** — premature PDP sprawl.
- **Tenant-admin ability to self-grant entitlements** — entitlement assignment is system-operator-only and audited.

## Implementation phases

1. **Entitlement model + repository (Phase 1, build).** Tenant-scoped entitlement set; system-operator assignment; RLS; audited.
2. **Chain integration (Phase 1).** Add the entitlement step to the BFF pipeline after permission; declare entitlement keys as route metadata; deny-by-default; `PolicyDecisionPort` seam confirmed around UMA.
3. **Quota hook (Phase 1, placeholder).** A no-op pass-through point in the chain; **no enforcement claimed**.
4. **Delegated admin (Phase 6).** Keycloak fine-grained admin + scope mapping + UI; audited; subset-of-granter invariant.
5. **Real quota enforcement (Phase 2).** Replace the hook with Redis-counter + entitlement-limit enforcement (ADR-0057).

## Acceptance criteria

- The chain evaluates in the defined order, deny-by-default, fail-closed; first failure returns the correct typed error/status.
- No entitlement → capability unavailable; removing an entitlement blocks access on the next request.
- Tenant-admin cannot grant entitlements to any tenant (including their own); system-operator assignment is audited; tenant-admin read is permission-gated.
- Permission and entitlement are independent and both required; neither is inferable by React.
- A feature flag never satisfies an entitlement check.
- Quota hook is a verifiable no-op; nothing claims quota enforcement.
- `proof:entitlement-policy-chain`, `proof:delegated-admin-policy`, `proof:policy-deny-by-default` pass.

## Proof requirements

`proof:entitlement-policy-chain` (full chain order + deny-by-default + entitlement gating), `proof:policy-deny-by-default` (absence = denial; fail-closed on infra down), `proof:delegated-admin-policy` (subset-of-granter; cannot grant entitlements) — the last lands with Phase 6. Existing `authorize-resource` UMA tests continue to pass.

## Production blockers

- Delegated admin must not ship before the subset-of-granter + audit invariants are proven.
- Quota enforcement must not be claimed before Phase 2.
- An external PDP (if ever adopted) must be proven fail-closed before production.

## Consequences

Positive: a single, ordered, deny-by-default authorization model; clean separation of entitlements/permissions/policy/quota; reuses proven UMA; delegation becomes first-class and audited; no premature PDP sprawl.

Negative: the four-concept model adds conceptual surface; the pipeline grows an entitlement step; delegated-admin UI is net-new (Phase 6).

Neutral / operational: the `PolicyDecisionPort` keeps an external engine possible without rework; quota slots in at Phase 2 behind the same chain.

## Validation / evidence

Evidence level: High (access-control risk). Local proof via the chain/deny/delegation proofs above + existing `authorize-resource` tests. Phase-1 delivery scope: `docs/evidence/platform/phase-1-service-catalog-entitlements-scope.md`.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0242 PDP/delegated admin; ADR-ACT-0241 entitlements/quota link; ADR-ACT-0253 hardening).

## References

ADR-0021, ADR-0030, ADR-0040, ADR-0053, ADR-0055, ADR-0057, ADR-0066; `docs/evidence/platform/universal-service-foundation-delivery-dependencies.md`.

## Notes

Hardened to decision quality and marked implementation-ready for Phase 1; formal acceptance still requires human architecture review.
