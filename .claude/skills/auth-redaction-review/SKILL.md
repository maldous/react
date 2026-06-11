---
name: auth-redaction-review
description: Review auth / IdP / credential / session / MFA changes for secret leakage, raw Keycloak config exposure, audit-metadata safety, strict redacted DTO mapping, and server-side-only tenant authority. Use when files under auth, IdP, credential, session, or MFA, or the Keycloak adapter, change.
---

# Auth & secret-redaction review

Review authentication-surface changes for leakage and redaction correctness. Report only; make no
product changes. This surface is governed by ADR-0022/0030/0037/0041/0042/0043/0044.

## Trigger conditions

- Changes to `/admin/auth` UI, auth-settings routes/use-cases, or auth DTOs.
- Changes to IdP, credential-lifecycle, session-policy, or MFA-policy code.
- Any change to the Keycloak realm-admin adapter or its mapping.

## Files / dirs to inspect

- `packages/adapters-keycloak/**` (realm-admin adapter, secret-mask round-trips).
- `apps/platform-api/**` auth-settings / idp / credential / session / mfa routes + use-cases + DTOs.
- `packages/contracts-auth/**` for DTO shape.
- `apps/platform-api/scripts/*-runtime-proof.ts` (the live proofs).
- ADR-0043 (IdP redaction), ADR-0041/0044 (credential lifecycle), ADR-0042 (MFA).

## Checks

1. **No secret leakage** — `clientSecret`/credentials never returned in responses, logged, or written to audit metadata.
2. **Write-only secrets** — `clientSecret` is write-only; blank-on-update preserves the existing value (secret-mask round-trip), never wipes it.
3. **Redacted DTOs** — summary DTOs expose only safe fields (e.g. `hasClientSecret: boolean`), never raw Keycloak config.
4. **Strict DTO mapping** — explicit allowlisted mapping; no pass-through of raw realm/provider objects.
5. **Audit-first, no-secret audit** — mutations audit before/after with safe metadata only.
6. **No frontend tenant authority** — the SPA never decides auth authorisation; readiness/permission comes from the server.
7. **Validation** — alias/URL validation, reserved-alias protection where applicable.

## Commands to run / recommend

```bash
npm run secrets:scan
# the relevant live proof (requires local Keycloak up — see CLAUDE.md ports):
npm run proof:auth-settings        # or proof:auth-idps / proof:auth-credential-lifecycle
```

Use the `live-proof` skill to classify whether a claim is live-proven vs node:test/MSW.

## Report template

```text
Auth/redaction review: PASS | ISSUES

Scope: <files>
Secret leakage: <none / file:line — what leaks>
Write-only clientSecret + blank-on-update: <ok / issue>
Redacted DTOs: <ok / raw config exposed at ...>
Audit metadata safety: <ok / unsafe field>
Frontend tenant authority: <server-side only? Y/N>
secrets:scan: <clean / findings>
Proof: <which proof run / not run + layer>
```
