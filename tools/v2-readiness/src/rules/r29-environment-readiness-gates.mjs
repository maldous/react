import { finding } from "../vocab.mjs";
import { VALID_PROVIDER_CLASSES, present } from "./quality.mjs";

const envs = ["dev", "test", "staging", "prod"];

export default function r29EnvironmentReadinessGates(ctx) {
  const out = [];
  const doc = ctx.foundation?.["environment-readiness-gates.json"];
  const matrix = ctx.foundation?.["environment-capability-matrix.json"];
  if (!doc) {
    return [
      finding(
        "R29-environment-readiness-gates",
        "environment-readiness-gates.json",
        "missing environment readiness gates"
      ),
    ];
  }
  for (const env of envs) {
    const gate = doc[env];
    if (!gate) {
      out.push(finding("R29-environment-readiness-gates", env, "missing environment gate"));
      continue;
    }
    for (const field of ["purpose", "requiredCommands", "requiredProofLevels", "allowedProviders"])
      if (!present(gate[field]))
        out.push(finding("R29-environment-readiness-gates", env, `gate missing "${field}"`));
    if (env !== "prod" && gate.allowedMocks !== true && env !== "staging")
      out.push(
        finding("R29-environment-readiness-gates", env, "dev/test gate should allow declared mocks")
      );
    if ((env === "prod" || env === "staging") && gate.allowedMocks !== false)
      out.push(
        finding("R29-environment-readiness-gates", env, "staging/prod gate must forbid mocks")
      );
    for (const provider of gate.allowedProviders || [])
      if (!VALID_PROVIDER_CLASSES.has(provider))
        out.push(
          finding("R29-environment-readiness-gates", env, `invalid allowed provider ${provider}`)
        );
  }
  if (doc.prod?.forbiddenProofs && !JSON.stringify(doc.prod.forbiddenProofs).match(/destructive/i))
    out.push(
      finding("R29-environment-readiness-gates", "prod", "prod must forbid destructive proofs")
    );
  if (matrix?.capabilities) {
    for (const row of matrix.capabilities) {
      for (const env of envs) {
        const providerClass = row[env]?.providerClass;
        if (
          providerClass &&
          doc[env]?.allowedProviders &&
          !doc[env].allowedProviders.includes(providerClass)
        )
          out.push(
            finding(
              "R29-environment-readiness-gates",
              row.capability,
              `${env} providerClass ${providerClass} contradicts environment gate`
            )
          );
      }
      if (row.prod?.mocksAllowed !== false)
        out.push(
          finding("R29-environment-readiness-gates", row.capability, "prod matrix allows mocks")
        );
    }
  }
  return out;
}
