import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanCtx, clone } from "./fixtures.mjs";
import r21 from "../src/rules/r21-v1c17-observability.mjs";

// Clean fixture already includes observabilityV1C17 with passing defaults; the rule must
// pass on the canonical clean fixture (the existing "clean fixture passes every rule" test
// in rules.test.mjs will fail if this rule regresses).
test("R21 fires when observabilityV1C17 is absent (no fixtures configured)", () => {
  const c = clone(cleanCtx());
  delete c.observabilityV1C17;
  assert.deepEqual(r21(c), []); // silent on unloadable ctx (load.mjs failed)
});

test("R21 passes on clean fixture", () => {
  assert.deepEqual(r21(cleanCtx()), []);
});

test("R21 fires when fewer than 3 dashboards are on disk", () => {
  const c = clone(cleanCtx());
  c.observabilityV1C17.files = 2;
  const f = r21(c);
  assert.ok(f.length === 1, "single finding for short dashboards list");
  assert.equal(f[0].ruleId, "R21-v1c17-observability");
  assert.match(f[0].subject, /dashboards\//);
  assert.match(f[0].message, /≥3 dashboards/);
});

test("R21 fires when no Grafana panel references platform-prometheus", () => {
  const c = clone(cleanCtx());
  c.observabilityV1C17.promRefs = 0;
  const f = r21(c);
  assert.ok(
    f.some((x) => /prometheus/.test(x.message)),
    "finds missing prometheus ref"
  );
});

test("R21 fires when no Grafana panel references platform-loki", () => {
  const c = clone(cleanCtx());
  c.observabilityV1C17.lokiRefs = 0;
  const f = r21(c);
  assert.ok(f.some((x) => /loki/.test(x.message)));
});

test("R21 fires when no Grafana panel references platform-tempo", () => {
  const c = clone(cleanCtx());
  c.observabilityV1C17.tempoRefs = 0;
  const f = r21(c);
  assert.ok(f.some((x) => /tempo/.test(x.message)));
});

test("R21 fires when metrics-prometheus-runtime-proof is absent", () => {
  const c = clone(cleanCtx());
  c.observabilityV1C17.proofScripts.metricsPrometheusExists = false;
  const f = r21(c);
  assert.ok(f.some((x) => /metrics-prometheus/.test(x.message)));
});

test("R21 fires when dashboards-runtime-proof is absent", () => {
  const c = clone(cleanCtx());
  c.observabilityV1C17.proofScripts.dashboardsExists = false;
  const f = r21(c);
  assert.ok(f.some((x) => /dashboards/.test(x.message)));
});

test("R21 aggregates all six failure modes in one ctx", () => {
  const c = clone(cleanCtx());
  c.observabilityV1C17 = {
    files: 1,
    promRefs: 0,
    lokiRefs: 0,
    tempoRefs: 0,
    proofScripts: { metricsPrometheusExists: false, dashboardsExists: false },
  };
  const f = r21(c);
  assert.equal(f.length, 6);
});
