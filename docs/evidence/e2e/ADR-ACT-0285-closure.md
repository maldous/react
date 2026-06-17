# ADR-ACT-0285 closure — scenario manifest, Tempo trace correlation, honest ladder

Status: **In Progress** until a committed-SHA `make all` ladder passes `verify-ladder`
(see "Gate to Done"). Records the implementation + the in-session live proofs. This file
is NOT a stage-evidence artifact (the per-stage evidence under `docs/evidence/stages/` is).

## Scope delivered

- **Scenario manifest (A)** — `e2e/scenario-manifest.json` is the canonical source of
  correlatable scenarios with stable explicit ids (never sanitised titles). Specs declare ids
  via `test.use({ scenarioId })` / the `scenario()` annotation. `tools/e2e/validate-scenario-manifest`
  uses the **TypeScript AST** to enforce ONE mapping per executable `test()`: literal ids and
  persona templates must match the manifest (adding an un-mapped test, or drifting a source id
  vs the manifest in either direction, fails). The 18 exemptions are categorised
  (`external-origin-noncorrelatable` / `prod-could-correlate-deferred` / `non-observability`)
  so an exemption is never used merely because migration is inconvenient.
- **Strict same-origin correlation (hardening #1)** — the Playwright fixture's browser route
  injection uses `correlatedRouteHeaders` (URL-origin parse), NOT `startsWith`. Headers are
  never sent to `aldous.info.evil.example`, `aldous.info@evil.example`, Keycloak, Cloudflare,
  or a different scheme/host/port. Tested for both the APIRequestContext wrapper and the route
  injection (the exact logic the fixture calls).
- **Per-scenario completeness (B)** — `observability-correlation` queries Loki per scenario
  with backward pagination (no 200-line blind spot; truncation surfaced) and FAILS on any
  missing REQUIRED scenario. The synthetic `pipeline-health-probe` is its own scenario and
  never substitutes for real scenarios.
- **Real Tempo trace assertions (C + hardening #4)** — `tools/e2e/tempo-trace.mjs`: 32-hex
  trace ids only; per-span trace-membership; exact/normalised route matching; multi-traceId
  evaluation (never blindly the first; `allTraceIds` forces every id); DEGRADED (network /
  5xx / auth / malformed / unconfigured) vs FAILED (genuine 404 after polling) classification;
  monotonic status aggregation across scenarios. TWO required trace scenarios:
  - `pipeline-health-probe` → `platform-api` span (server-side denial).
  - `browser-bff-trace` → a REAL browser→BFF distributed trace containing BOTH
    `react-enterprise-app` and `platform-api` spans (Faro propagates `traceparent` to the
    same-origin BFF call).
- **Tempo availability (D)** — `scripts/compose/up.sh` observability starts
  `loki tempo grafana alloy`; per-stage `TEMPO_HTTP_PORT` (3210–3213).
- **Honest ladder (E)** — `verify-ladder` requires ALL FOUR stages FULL. Direct
  `make stage-<stage>` returns exit 2 on DEGRADED; only `_all-promote-internal` sets
  `LADDER_CONTINUE_ON_DEGRADED=1`; FAILED always halts. `make all-promote` (direct) now runs
  `evidence` too, so it never reports success on a degraded stage.
- **Secure attestation (F + hardening #5)** — evidence-only-commit model with strict-hex SHA
  validation (a malicious gitSha is rejected before any git call), `execFileSync` argument
  arrays (no shell), and fail-closed merge-base/diff handling.

## In-session live proofs (against the running react-prod stack)

- platform-api trace: unauthenticated denial → Loki traceId → Tempo trace found → contract ok
  (`services:[platform-api]`, route matched, 0 secrets).
- browser→BFF trace: a real Chromium in-page fetch produced ONE trace with **both**
  `platform-api` and `react-enterprise-app` spans (3 spans), confirming the
  `browser-bff-trace` scenario is satisfiable before being declared `traces=required`.

## Tests (all green)

`npm run test:architecture` runs: scenario-manifest (incl. AST per-test), tempo-trace (32-hex
/ membership / classification / multi-traceId), correlation-headers (hostile-origin matrix for
both paths), observability completeness + pagination, verify-ladder (incl. malicious-SHA /
fail-closed), stage-exit. `make check` passes.

## Gate to Done

Done requires a CLEAN, committed-SHA `make all`: commit the code/tooling/docs first, run
`make all` against that committed HEAD (real auth + DNS), confirm all four stages FULL, zero
missing required scenarios, and BOTH the `pipeline-health-probe` (platform-api) and
`browser-bff-trace` (react-enterprise-app + platform-api) traces PASS, then commit only the
generated evidence/governance files and confirm `node scripts/evidence/verify-ladder.mjs`
passes on the evidence commit. The earlier commit `4029681` does NOT satisfy this (its evidence
references tested sha `70917e9` while `4029681` changes source/tooling — verify-ladder correctly
rejects it); this is a real freshness failure, not cosmetic.
