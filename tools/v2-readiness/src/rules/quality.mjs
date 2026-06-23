const PLACEHOLDER_RE = /\b(TBD|TODO|placeholder|lorem|dummy|example only|not yet|to be decided)\b/i;
const FIXTURE_EVENT_NAMES = new Set([
  "x",
  "t",
  "boom",
  "thing.created",
  "ok.event",
  "boom.event",
  "no.handler",
  "platform.test",
]);
export const VALID_EVENT_CATEGORIES = new Set([
  "product",
  "platform",
  "integration",
  "audit",
  "fixture",
  "test-only",
  "deprecated",
]);
export const VALID_PROVIDER_CLASSES = new Set([
  "hermetic",
  "in-memory",
  "compose-local",
  "sandbox-external",
  "live-external",
  "fake-http-adapter",
  "none",
]);
export const VALID_ENVIRONMENTS = new Set(["dev", "test", "staging", "prod"]);
export const VALID_PROOF_LEVELS = new Set([0, 1, 2, 3, 4, 5, 6]);

export const present = (value) =>
  value != null && value !== "" && !(Array.isArray(value) && value.length === 0);

export function isPlaceholder(value) {
  if (!present(value)) return true;
  return PLACEHOLDER_RE.test(typeof value === "string" ? value : JSON.stringify(value));
}

export function isFixtureEventName(name) {
  return FIXTURE_EVENT_NAMES.has(name) || /^[a-z]$/.test(String(name || ""));
}

export function isGenericOperationalText(value, capabilityName = "") {
  if (!present(value)) return true;
  const text = Array.isArray(value) ? value.join(" ") : String(value);
  if (isPlaceholder(text)) return true;
  if (capabilityName && !text.includes(capabilityName) && text.length < 80) return true;
  return /^(deploy|migration|rollback|backup|recover|degraded|partial failure|signal|alert|policy|contract|boundary)$/i.test(
    text.trim()
  );
}

export function hasRealSourceReference(refs) {
  if (!Array.isArray(refs) || refs.length === 0) return false;
  return refs.some((ref) => /^(apps|packages|tools|docs|scripts|config|make)\//.test(ref));
}

export function capabilityExists(ctx, name) {
  return (ctx.capabilities || []).some(
    (capability) => capability.status === "delivered-and-proven" && capability.capability === name
  );
}

export function proofExists(ctx, proofRef) {
  if (!present(proofRef)) return false;
  const refs = Array.isArray(proofRef) ? proofRef : String(proofRef).split(/[;,]/);
  const haystack = [
    ...(ctx.testInventory || []).map(
      (record) =>
        `${record.id || ""} ${record.path || ""} ${record.sourceCommand || ""} ${record.scriptPath || ""}`
    ),
    ...(ctx.capabilities || []).map(
      (capability) => `${capability.proof || ""} ${capability.semanticCompleteness?.proof || ""}`
    ),
  ].join("\n");
  return refs
    .map((ref) => String(ref).trim())
    .filter(Boolean)
    .every((ref) =>
      ref.startsWith("proof:")
        ? haystack.includes(ref) || haystack.includes(ref.replace(/^proof:/, ""))
        : haystack.includes(ref) || /^(apps|packages|tools|docs|scripts)\//.test(ref)
    );
}

export function eventExists(ctx, name) {
  const events = ctx.foundation?.["event-semantics.json"]?.events || [];
  return events.some((event) => event.eventName === name);
}

export function validEnvironmentPolicy(entry, env) {
  if (!entry || !VALID_ENVIRONMENTS.has(env)) return false;
  if (!VALID_PROVIDER_CLASSES.has(entry.providerClass)) return false;
  if (typeof entry.tenantDataAllowed !== "boolean") return false;
  for (const field of [
    "provider",
    "dataClass",
    "mockPolicy",
    "sandboxPolicy",
    "liveProviderPolicy",
    "secretPolicy",
    "networkPolicy",
    "proofLevelRequired",
    "requiredProofs",
    "requiredSmokeChecks",
    "seedDataPolicy",
    "destructiveProofPolicy",
    "promotionGate",
    "rollbackGate",
    "observabilityRequired",
    "costRisk",
    "securityRisk",
    "externalDependencyRisk",
  ])
    if (!present(entry[field])) return false;
  return true;
}
