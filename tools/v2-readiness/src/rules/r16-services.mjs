import { finding } from "../vocab.mjs";

// Composed sub-service families that fold to one matrix row.
const FAMILY = { sentry: "sentry", sonar: "sonarqube", sonarqube: "sonarqube" };
// Application/edge services that are not third-party "clickthrough" composed services.
const NOT_COMPOSED_SERVICE = new Set(["platform-api", "react-app", "external-caddy"]);
const truthy = (v) => v != null && v !== "" && !/^(n\/a|none)\b/i.test(String(v));

// Live Compose ⇆ service-and-clickthrough matrix reconciliation (§1).
export default function r16Services(ctx) {
  const out = [];
  const matrix = ctx.foundation?.["service-and-clickthrough-matrix.json"];
  if (!Array.isArray(matrix)) {
    out.push(
      finding(
        "R16-services",
        "service-and-clickthrough-matrix.json",
        "missing or malformed service matrix"
      )
    );
    return out;
  }
  const ids = new Set(matrix.map((s) => s.id));
  const covered = (n) =>
    ids.has(n) ||
    NOT_COMPOSED_SERVICE.has(n) ||
    [...ids].some((id) => n.startsWith(id + "-")) ||
    Object.entries(FAMILY).some(([p, target]) => n.startsWith(p) && ids.has(target));

  if (ctx.compose?.ok) {
    const svc = ctx.compose.services.map((s) => s.name);
    const svcSet = new Set(svc);
    // forward: every compose service maps to a matrix row (or is an app/edge service)
    for (const n of svc)
      if (!covered(n))
        out.push(
          finding(
            "R16-services",
            n,
            "compose service missing from the service-and-clickthrough matrix"
          )
        );
    // reverse: every matrix service exists in compose (exact/prefix) OR is explicitly external
    for (const s of matrix) {
      const inCompose =
        svcSet.has(s.id) || svc.some((n) => n.startsWith(s.id + "-") || n.includes(s.id));
      if (!inCompose && !/external/i.test(s.classification || ""))
        out.push(
          finding(
            "R16-services",
            s.id,
            "matrix service neither exists in compose nor is classified external"
          )
        );
    }
  } else {
    out.push(
      finding(
        "R16-services",
        "compose.yaml",
        "could not parse compose.yaml; service reconciliation not verified",
        "warning"
      )
    );
  }

  // matrix internal invariants
  const REQ = [
    "id",
    "classification",
    "caddyRoute",
    "clickthroughUrl",
    "permission",
    "forwardAuthResource",
    "ssoMechanism",
    "readiness",
    "productionExposure",
    "directLoginPolicy",
  ];
  for (const s of matrix) {
    for (const k of REQ)
      if (!(k in s))
        out.push(finding("R16-services", s.id || "<svc>", `matrix row missing field "${k}"`));
    // a routed GUI service must declare a clickthrough URL + a permission
    if (truthy(s.caddyRoute) && truthy(s.clickthroughUrl) && !truthy(s.permission))
      out.push(
        finding(
          "R16-services",
          s.id,
          "GUI service has a clickthrough URL but no permission (clickthrough decision incomplete)"
        )
      );
    // a forward-auth resource must declare its permission
    if (truthy(s.forwardAuthResource) && !truthy(s.permission))
      out.push(
        finding("R16-services", s.id, "forward-auth resource without a declared permission")
      );
    // an SSO-enabled service must record its credentials/proof
    if (
      truthy(s.ssoMechanism) &&
      !/native|forward-auth|n\/a|none/i.test(String(s.ssoMechanism)) &&
      !truthy(s.credentials) &&
      !truthy(s.proof)
    )
      out.push(
        finding(
          "R16-services",
          s.id,
          "SSO-enabled service lacks credentials/proof (Keycloak client/config)"
        )
      );
    // direct/native login policy must be DECLARED (an explicit "n/a (proxy)" is a valid declaration)
    if (s.directLoginPolicy == null || s.directLoginPolicy === "")
      out.push(finding("R16-services", s.id, "direct/native login policy undeclared"));
    // a selected composed provider must declare readiness
    if (/built-in|composed/i.test(s.classification || "") && !truthy(s.readiness))
      out.push(
        finding("R16-services", s.id, "composed provider has no readiness/probe configuration")
      );
  }
  return out;
}
