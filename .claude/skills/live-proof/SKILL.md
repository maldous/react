---
name: live-proof
description: Plan and execute repeatable proof scripts or manual proof steps, and classify each claim as live-proven, node:test-proven, MSW-proven, or not-yet-proven. Use when verifying runtime behaviour or before claiming live/production verification.
---

# Live proof planner & executor

Plan, run, and honestly classify proof of runtime behaviour. Never claim live or production verification
without actually running the relevant command (constraint #10). Make no product changes.

## Trigger conditions

- A claim about runtime/live behaviour is about to be made.
- An evidence file needs a "tests run + proof layer" section (pairs with `evidence-bundle`).
- Verifying an auth/identity/admin slice end to end.

## Proof layers (always classify each claim)

- **live-proven** — a `proof:*` script or live E2E ran against real local services (Keycloak/Postgres/etc.) and read back.
- **node:test-proven** — covered by `npm run test:platform-api` / `test:architecture` (no live infra).
- **MSW-proven** — frontend behaviour verified against MSW handlers, not a live backend.
- **not-yet-proven** — asserted but unverified; must be stated as such.

## Prerequisites to check first

- `make compose-ps` — required services up (postgres, redis, keycloak under the `identity` profile, mailpit…).
- Health: `curl -fsS http://localhost:3001/healthz` / `/readyz`.
- Local Keycloak is per-env on 8090–8093/kc (not 8080) — see CLAUDE.md ports + memory.
- If Docker/network/browser deps are unavailable, say so and downgrade the claim to not-yet-proven.

## Commands by surface

```bash
# Live auth proofs (need local Keycloak):
npm run proof:auth-settings
npm run proof:auth-idps
npm run proof:auth-credential-lifecycle

# Test layers:
npm run test:platform-api
npm run test:frontend:run
npm run test:e2e            # local E2E
npm run test:e2e:prod       # live production smoke — only when explicitly asked + network available

# Health / runtime awareness:
make compose-ps
docker compose logs --tail=120 postgres redis mailpit otel-collector
```

For UI proof, prefer the Playwright accessibility-snapshot flow against `localhost:5173` / dev tenants —
never a production tenant.

## Report template

```text
Proof plan/result

Surface: <what is being proven>
Prereqs: <services up? health ok?>
Runs:
  - <command> -> <PASS/FAIL> -> layer: live | node:test | MSW
Claims classified:
  - <claim> : live-proven | node:test-proven | MSW-proven | NOT-YET-PROVEN
Not proven / blocked: <reason — e.g. Docker unavailable>
```
