import { finding } from "../vocab.mjs";

const SECRET = /SECRET|PASSWORD|TOKEN|PEPPER|_KEY$|APIKEY|CREDENTIAL|PRIVATE/;
// Keys that must never be enabled in staging/prod manifests (mock/fixture/destructive modes).
const FORBIDDEN_IN_PROD = [
  "ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS",
  "LOCAL_FIXTURE_SESSION",
  "E2E_ALLOW_PROD_SYNTHETIC_FAILURE",
  "E2E_FAILURE_ENDPOINT_ENABLED",
];
const truthyVal = (v) => v === true || v === "true" || v === 1 || v === "1";

// Live environment/config reconciliation (§2) against the generated v1-config-consumption inventory
// and the env manifests. The config-runtime sprawl (direct env access outside composition roots) is a
// COMPLETION BLOCKER (decomposed V1C-CONF-*), not a consistency finding.
export default function r18EnvironmentConfig(ctx) {
  const out = [];
  const inv = ctx.configConsumption;
  if (!inv || !Array.isArray(inv.keys)) {
    out.push(
      finding(
        "R18-environment-config",
        "v1-config-consumption.json",
        "missing or malformed live config-consumption inventory"
      )
    );
    return out;
  }

  // each key carries the required fields + consistent secret classification
  const REQ = [
    "key",
    "consumerCount",
    "sources",
    "secret",
    "testFixtureOnly",
    "authoritativeSource",
    "v2Disposition",
    "directAccessOutsideComposition",
  ];
  const seen = new Set();
  for (const k of inv.keys) {
    for (const f of REQ)
      if (!(f in k))
        out.push(
          finding(
            "R18-environment-config",
            k.key || "<key>",
            `config-consumption entry missing "${f}"`
          )
        );
    if (seen.has(k.key))
      out.push(finding("R18-environment-config", k.key, "duplicate config-consumption key"));
    seen.add(k.key);
    // secret classification must agree with the name heuristic (no conflicting classification)
    if (SECRET.test(k.key || "") && k.secret !== true)
      out.push(
        finding(
          "R18-environment-config",
          k.key,
          "secret-named key not classified as secret (conflicting classification)"
        )
      );
    // a production (non-test) consumed key must declare an authoritative source
    if (!k.testFixtureOnly && !k.authoritativeSource)
      out.push(
        finding(
          "R18-environment-config",
          k.key,
          "production config key without an authoritative source"
        )
      );
  }

  // production secrets must not carry a literal default that is unsafe in staging/prod
  for (const stage of ["staging", "prod"]) {
    const m = ctx.envManifests?.[stage] || {};
    for (const [key, val] of Object.entries(m)) {
      if (
        SECRET.test(key) &&
        typeof val === "string" &&
        /^(changeme|password|secret|test|dev|admin|local)/i.test(val)
      )
        out.push(
          finding(
            "R18-environment-config",
            `${stage}:${key}`,
            "secret has an unsafe literal default in a deployed manifest"
          )
        );
    }
    // forbidden mock/fixture/destructive keys must not be enabled in staging/prod
    for (const fk of FORBIDDEN_IN_PROD)
      if (truthyVal(m[fk]) || truthyVal((ctx.envManifests?.common || {})[fk]))
        out.push(
          finding(
            "R18-environment-config",
            `${stage}:${fk}`,
            "mock/fixture/destructive mode enabled in a deployed manifest"
          )
        );
  }

  // topic catalogue entries are well-formed
  const cat = ctx.foundation?.["environment-and-config-catalog.json"];
  if (Array.isArray(cat))
    for (const e of cat)
      for (const f of ["key", "consumer", "secret", "sourceOfTruth", "v2Location"])
        if (!(f in e))
          out.push(
            finding(
              "R18-environment-config",
              e.key || "<topic>",
              `config-topic catalogue entry missing "${f}"`
            )
          );

  return out;
}
