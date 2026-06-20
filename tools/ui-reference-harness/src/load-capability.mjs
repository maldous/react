// Semantic Reference Harness — capability loader (pure).
//
// The single source of capability semantics is docs/v2-foundation/ui-capability-model.json.
// The harness reads harness-enabled records from there; it never defines its own copy.

export function listHarnessCapabilities(model) {
  return (model?.capabilities || []).filter((c) => c && c.harness);
}

export function selectCapability(model, capabilityKey) {
  return (
    listHarnessCapabilities(model).find(
      (c) => c.harness.capabilityKey === capabilityKey || c.capabilityId === capabilityKey
    ) || null
  );
}

export function harnessCapabilityKeys(model) {
  return listHarnessCapabilities(model).map((c) => c.harness.capabilityKey);
}
