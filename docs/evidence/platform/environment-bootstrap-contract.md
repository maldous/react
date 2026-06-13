# Environment bootstrap contract + promotion ladder

Source ADR: ADR-0072 · Action: ADR-ACT-0274

## Scope delivered

The Makefile owns the deployment-ladder bootstrap. The ADR-0034 confidence ladder
(`all → clean-all → preflight → quality → env-validate-all → env-drift-check →
all-promote → evidence → env-status`; `all-promote` = sentry-up → stage-dev →
stage-test → external-caddy-up → stage-staging → stage-prod) is preserved unchanged.
dev=Tilt; test/staging/prod=Compose. dev/test destructive; staging/prod preserve.

### Targets (ADR-0072)

`env-generate-runtime`, `env-init`, `env-bootstrap`, `env-reconcile`,
`env-seed-secrets`, `env-seed-providers`, `env-seed-config`, `env-seed-admin`,
`env-print-admin`, `env-rotate-secret`, `env-provider-up`, `env-provider-reconcile`,
`env-bootstrap-seed`.

`run-stage.sh` runs `env-bootstrap-seed` after migrations (non-fatal) so `make all`
performs the full end state per stage: registry sync → provider_configs seeded
(`candidate`) → OpenBao secrets seeded → global admin handoff. Every seed step
degrades honestly (SKIP, never fail/fake) when Postgres/OpenBao is unreachable, so the
ladder is never weakened.

### Global system administrator handoff

`make env-seed-admin ENV=<stage>` prints:

```text
Environment: <stage>
URL:         <baseUrl>
Username:    <usernameTemplate>
Password:    <one-time generated>
Secret ref:  secret:<uuid>
```

The persisted marker `.env/secrets/<stage>.admin.json` holds NO plaintext password —
only username + opaque secretRef + metadata. The password is the generated
`SYSADMIN_BOOTSTRAP_PASSWORD`; when OpenBao is reachable it is stored there.
staging/prod are flagged LOCAL/BOOTSTRAP MODE (rotate before real exposure).
`make env-print-admin ENV=<stage>` is the authorised local re-print.

## Proof (live + deterministic)

- `proof:environment-admin-bootstrap` — handoff format, password == generated value,
  no-plaintext marker, local-bootstrap flagging, re-print.
- `proof:environment-registry` (live) — registry sync + provider seeding via the same
  usecases the seed scripts use.

## Not delivered

Full DB-password rotation (modelled in the ADR; provider-credential rotation is
delivered via `env-rotate-secret`). IdP-backed creation of the sysadmin Keycloak user
(handoff + OpenBao seed delivered).

## Linkage

ADR-0072 · ADR-ACT-0274 · preserves ADR-0034 (confidence ladder), ADR-0027 (Tilt).
