import { finding } from "../vocab.mjs";

// V1C-17 (Metrics + traces) observability surface: on-disk Grafana dashboards, datasource UID
// coverage across the set, and presence of the metrics-prometheus + dashboards runtime-proof
// scripts. ADR-0062 (observability foundation) + ADR-0067 (metering) surface. The rule is only
// active when load.mjs populated ctx.observabilityV1C17; pure rule for testability.
//
// Threshold semantics (tied to v1-completion-actions.json V1C-17 partial-flip):
//   - ≥3 dashboards on disk (the partial slice; full closure target is documented in the
//     ADR-ACT and the V1C-17 ledger providerRequiredFollowup field, not in this rule).
//   - At least one panel references the prometheus provisioning uid (platform-prometheus).
//   - At least one panel references the loki provisioning uid (platform-loki).
//   - At least one panel references the tempo provisioning uid (platform-tempo).
//   - The metrics-prometheus-runtime-proof + dashboards-runtime-proof scripts exist on disk
//     so the partial slice can be exercised against a live compose stack when the operator
//     brings one up.
//
// PARTIAL THRESHOLD marker:
//   The numeric floors above (≥3 dashboards, ≥1 of each datasource uid, both proof scripts
//   present) are the PARTIAL floors for V1C-17 status='in-progress'. They are NOT the
//   full-closure floors; a future flip to 'delivered-and-proven' requires green runs of
//   `npm run proof:metrics-prometheus` + `npm run proof:dashboards` AND the 4+ additional
//   dashboards enumerated in v1-completion-actions.json V1C-17.providerRequiredFollowup.
//   Do not tighten the floors in this rule without reconciling the ledger text.
export default function r21V1c17Observability(ctx) {
  const out = [];
  const obs = ctx.observabilityV1C17;
  if (!obs) return out; // not yet loaded — unloadable ctx (test fixture); rule is silent

  if (typeof obs.files !== "number" || obs.files < 3)
    out.push(
      finding(
        "R21-v1c17-observability",
        "docker/grafana/dashboards/",
        `expected ≥3 dashboards on disk to mark V1C-17 partial-proven; found ${obs.files ?? 0}`
      )
    );

  if (typeof obs.promRefs !== "number" || obs.promRefs < 1)
    out.push(
      finding(
        "R21-v1c17-observability",
        "docker/grafana/dashboards/",
        "no Grafana panel references the prometheus datasource uid (platform-prometheus)"
      )
    );

  if (typeof obs.lokiRefs !== "number" || obs.lokiRefs < 1)
    out.push(
      finding(
        "R21-v1c17-observability",
        "docker/grafana/dashboards/",
        "no Grafana panel references the loki datasource uid (platform-loki)"
      )
    );

  if (typeof obs.tempoRefs !== "number" || obs.tempoRefs < 1)
    out.push(
      finding(
        "R21-v1c17-observability",
        "docker/grafana/dashboards/",
        "no Grafana panel references the tempo datasource uid (platform-tempo)"
      )
    );

  const proofs = obs.proofScripts || {};
  if (!proofs.metricsPrometheusExists)
    out.push(
      finding(
        "R21-v1c17-observability",
        "apps/platform-api/scripts/metrics-prometheus-runtime-proof.ts",
        "metrics-prometheus runtime proof script is absent (required for V1C-17a closure)"
      )
    );
  if (!proofs.dashboardsExists)
    out.push(
      finding(
        "R21-v1c17-observability",
        "apps/platform-api/scripts/dashboards-runtime-proof.ts",
        "dashboards runtime proof script is absent (required for V1C-17b closure)"
      )
    );

  return out;
}
