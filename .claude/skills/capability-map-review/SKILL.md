---
name: capability-map-review
description: Review the enterprise capability registry and tenant readiness map — ensure each capability has a route, permission, contract, port, adapter, audit action, readiness check, evidence, and implementation status, and that readiness is never faked. Use when the capability registry or /admin/readiness surface changes.
---

# Capability map & readiness review

Review the server-owned Capability Registry and the `/admin/readiness` surface (ADR-0045 / ADR-ACT-0213).
The control plane must stay self-describing and honest. Report only; make no broad product changes.

## Trigger conditions

- A capability is added/changed/removed in the Capability Registry.
- `GET /api/org/readiness` (`getTenantReadiness`) aggregation logic changes.
- The `/admin/readiness` UI changes.
- A capability's `implementationStatus` transitions (deferred → partial → implemented).

## Files / dirs to inspect

- The server Capability Registry + `getTenantReadiness` use-case + `GET /api/org/readiness` route.
- The `/admin/readiness` React surface (grouped capability cards).
- `docs/evidence/platform/enterprise-control-plane-capability-map.md` (the matrix of record).
- ADR-0045; cross-refs ADR-0030/0036/0037/0040/0041.

## Checks (per capability)

1. **Completeness** — each capability declares: category, `adminRoute` (or documented none), `requiredPermission`, contract, port, adapter, audit action, readiness source, evidence, `implementationStatus` (implemented/partial/deferred).
2. **Readiness honesty** — readiness comes from a **live check** or a **documented invariant**; never faked. If neither, it is reported `deferred`/`unknown`. (Constraint #10 spirit.)
3. **Aggregation** — overall status uses worst-wins over `required` capabilities (`blocked > degraded > incomplete > unknown > ready`); `deferred`/non-required never drag overall down.
4. **OIDC-first** — SAML stays out of scope (not listed); OIDC enterprise sub-caps listed `deferred` so the gap is visible.
5. **Matrix parity** — the registry matches the evidence matrix in `enterprise-control-plane-capability-map.md`; status transitions are reflected in both + the ACTION-REGISTER.
6. **No frontend authority** — `/admin/readiness` renders server truth; it computes no readiness/authority itself.

## Commands to run / recommend

```bash
# live readiness (needs local services up — see live-proof skill):
curl -fsS http://localhost:3001/api/org/readiness
npm run test:platform-api        # targeted readiness/registry tests
```

Use `live-proof` to classify readiness claims and `evidence-bundle` to keep the matrix evidence in sync.

## Report template

```text
Capability map review: PASS | ISSUES

Scope: <capabilities/files>
Completeness: <each cap has route/permission/contract/port/adapter/audit/readiness/evidence/status? gaps:>
Readiness honesty: <all live-or-invariant? faked/assumed at ...>
Aggregation (worst-wins over required): <correct? Y/N>
OIDC-first (SAML excluded, OIDC sub-caps deferred-visible): <ok / issue>
Registry <-> evidence matrix parity: <in sync? Y/N>
Frontend authority: <renders server truth only? Y/N>
```
