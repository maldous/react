#!/usr/bin/env python3
"""Register V1C-17a/b and V1C-18 new files, commands, and proofs in v2-readiness catalogues."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def load_json(rel_path):
    with open(os.path.join(ROOT, rel_path)) as f:
        return json.load(f)

def save_json(rel_path, data):
    with open(os.path.join(ROOT, rel_path), 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')

# ── 1. v1-post-audit-delta.json ──────────────────────────────────────────
delta = load_json("docs/v2-foundation/v1-post-audit-delta.json")
existing_paths = {a['path'] for a in delta['additions']}

new_files = [
    {
        "path": "apps/platform-api/scripts/dashboards-runtime-proof.ts",
        "purpose": "V1C-17b: Grafana dashboard runtime proof",
        "v2Disposition": "reuse-unchanged",
        "v2Target": "apps/platform-api/scripts/dashboards-runtime-proof.ts",
        "protectingTests": [],
        "decisionRefs": ["ADR-ACT-0292"],
        "introducingCommit": "unknown"
    },
    {
        "path": "apps/platform-api/scripts/metrics-prometheus-runtime-proof.ts",
        "purpose": "V1C-17a: Prometheus metrics runtime proof",
        "v2Disposition": "reuse-unchanged",
        "v2Target": "apps/platform-api/scripts/metrics-prometheus-runtime-proof.ts",
        "protectingTests": [],
        "decisionRefs": ["ADR-ACT-0292"],
        "introducingCommit": "unknown"
    },
    {
        "path": "tools/security/codeql-validate.mjs",
        "purpose": "V1C-18: CodeQL validation script (graceful skip when codeql missing)",
        "v2Disposition": "reuse-unchanged",
        "v2Target": "tools/security/codeql-validate.mjs",
        "protectingTests": [],
        "decisionRefs": ["ADR-ACT-0292"],
        "introducingCommit": "unknown"
    },
    {
        "path": "tools/security/sbom-verify.mjs",
        "purpose": "V1C-18: SBOM verification script (format, freshness)",
        "v2Disposition": "reuse-unchanged",
        "v2Target": "tools/security/sbom-verify.mjs",
        "protectingTests": [],
        "decisionRefs": ["ADR-ACT-0292"],
        "introducingCommit": "unknown"
    },
    {
        "path": "tools/security/sbom-policy.mjs",
        "purpose": "V1C-18: SBOM policy script (license audit)",
        "v2Disposition": "reuse-unchanged",
        "v2Target": "tools/security/sbom-policy.mjs",
        "protectingTests": [],
        "decisionRefs": ["ADR-ACT-0292"],
        "introducingCommit": "unknown"
    },
]

added = 0
for f in new_files:
    if f['path'] not in existing_paths:
        delta['additions'].append(f)
        existing_paths.add(f['path'])
        added += 1

delta['additionCount'] = len(delta['additions'])
save_json("docs/v2-foundation/v1-post-audit-delta.json", delta)
print(f"[v1-post-audit-delta] Added {added} new files (total: {delta['additionCount']})")

# ── 2. v1-command-catalog.json ───────────────────────────────────────────
catalog = load_json("docs/v2-foundation/v1-command-catalog.json")
existing_names = {c['name'] for c in catalog}

new_commands = [
    {
        "name": "npm codeql:validate",
        "kind": "npm",
        "purpose": "Validate CodeQL setup (graceful skip when codeql not installed).",
        "inputs": [],
        "outputs": [],
        "prerequisites": [],
        "sideEffects": [],
        "envScope": "all",
        "failureSemantics": "skips with notice if codeql absent",
        "idempotent": True,
        "safetyControls": [],
        "testCoverage": "none",
        "duplicateOf": None,
        "hidesErrors": True,
        "dead": False,
        "docDriftsFromBehaviour": False
    },
    {
        "name": "npm sbom:verify",
        "kind": "npm",
        "purpose": "Verify SBOM presence, format, and freshness (CycloneDX 1.6).",
        "inputs": [],
        "outputs": [],
        "prerequisites": [],
        "sideEffects": [],
        "envScope": "all",
        "failureSemantics": "exit-nonzero on missing/invalid/stale SBOM",
        "idempotent": True,
        "safetyControls": [],
        "testCoverage": "none",
        "duplicateOf": None,
        "hidesErrors": False,
        "dead": False,
        "docDriftsFromBehaviour": False
    },
    {
        "name": "npm sbom:policy",
        "kind": "npm",
        "purpose": "Check SBOM for flagged licenses (GPL/AGPL/SSPL/Commons/BUSL).",
        "inputs": [],
        "outputs": [],
        "prerequisites": [],
        "sideEffects": [],
        "envScope": "all",
        "failureSemantics": "exit-nonzero on blocked license",
        "idempotent": True,
        "safetyControls": [],
        "testCoverage": "none",
        "duplicateOf": None,
        "hidesErrors": False,
        "dead": False,
        "docDriftsFromBehaviour": False
    },
    {
        "name": "npm proof:metrics-prometheus",
        "kind": "npm",
        "purpose": "Runtime proof harness for Prometheus application metrics (V1C-17a).",
        "inputs": ["running platform-api"],
        "outputs": ["proof evidence (stdout)"],
        "prerequisites": ["platform-api loader", "reachable /metrics endpoint"],
        "sideEffects": ["exercises live /metrics and /readyz"],
        "envScope": "all",
        "failureSemantics": "exit-nonzero on proof failure; honest degrade when backend down",
        "idempotent": True,
        "safetyControls": [],
        "testCoverage": "none",
        "duplicateOf": None,
        "hidesErrors": False,
        "dead": False,
        "docDriftsFromBehaviour": False
    },
    {
        "name": "npm proof:dashboards",
        "kind": "npm",
        "purpose": "Runtime proof harness for Grafana dashboard provisioning (V1C-17b).",
        "inputs": ["running Grafana"],
        "outputs": ["proof evidence (stdout)"],
        "prerequisites": ["Grafana reachable", "GRAFANA_ADMIN_USER/PASSWORD env"],
        "sideEffects": ["exercises Grafana API"],
        "envScope": "all",
        "failureSemantics": "exit-nonzero on proof failure; honest degrade when backend down",
        "idempotent": True,
        "safetyControls": [],
        "testCoverage": "none",
        "duplicateOf": None,
        "hidesErrors": False,
        "dead": False,
        "docDriftsFromBehaviour": False
    },
]

added = 0
for c in new_commands:
    if c['name'] not in existing_names:
        catalog.append(c)
        existing_names.add(c['name'])
        added += 1

save_json("docs/v2-foundation/v1-command-catalog.json", catalog)
print(f"[v1-command-catalog] Added {added} new commands (total: {len(catalog)})")

# ── 3. v2-command-map.json ──────────────────────────────────────────────
cmd_map = load_json("docs/v2-foundation/v2-command-map.json")
existing_v1names = {m['v1Name'] for m in cmd_map}

new_mappings = [
    {"v1Name": "npm codeql:validate", "v2Command": "npm codeql:validate", "v2Stage": "preflight", "migrationNotes": "Reuse unchanged; CodeQL local gate (graceful skip)"},
    {"v1Name": "npm sbom:verify", "v2Command": "npm sbom:verify", "v2Stage": "preflight", "migrationNotes": "Reuse unchanged; SBOM freshness/integrity gate"},
    {"v1Name": "npm sbom:policy", "v2Command": "npm sbom:policy", "v2Stage": "preflight", "migrationNotes": "Reuse unchanged; license audit gate"},
    {"v1Name": "npm proof:metrics-prometheus", "v2Command": "npm proof:metrics-prometheus", "v2Stage": "test", "migrationNotes": "Reuse unchanged; live-proof against platform-api /metrics"},
    {"v1Name": "npm proof:dashboards", "v2Command": "npm proof:dashboards", "v2Stage": "test", "migrationNotes": "Reuse unchanged; live-proof against Grafana API"},
]

added = 0
for m in new_mappings:
    if m['v1Name'] not in existing_v1names:
        cmd_map.append(m)
        existing_v1names.add(m['v1Name'])
        added += 1

save_json("docs/v2-foundation/v2-command-map.json", cmd_map)
print(f"[v2-command-map] Added {added} new mappings (total: {len(cmd_map)})")

# ── 4. v1-test-proof-inventory.json ─────────────────────────────────────
inv = load_json("docs/v2-foundation/v1-test-proof-inventory.json")
existing_ids = {i['id'] for i in inv}

new_proofs = [
    {
        "id": "apps/platform-api/scripts/metrics-prometheus-runtime-proof.ts",
        "path": "apps/platform-api/scripts/metrics-prometheus-runtime-proof.ts",
        "kind": "runtime-proof",
        "behaviourProtected": True,
        "fixtureEnvDependency": "live-runtime: compose postgres/redis via loader + preload-env",
        "stageCoverage": "test (live-proof stage)",
        "failureEvidence": "proof script exits non-zero; emits docs/evidence runtime-proof JSON/log"
    },
    {
        "id": "apps/platform-api/scripts/dashboards-runtime-proof.ts",
        "path": "apps/platform-api/scripts/dashboards-runtime-proof.ts",
        "kind": "runtime-proof",
        "behaviourProtected": True,
        "fixtureEnvDependency": "live-runtime: requires Grafana on compose network",
        "stageCoverage": "test (live-proof stage)",
        "failureEvidence": "proof script exits non-zero; emits docs/evidence runtime-proof JSON/log"
    },
]

added = 0
for p in new_proofs:
    if p['id'] not in existing_ids:
        inv.append(p)
        existing_ids.add(p['id'])
        added += 1

save_json("docs/v2-foundation/v1-test-proof-inventory.json", inv)
print(f"[v1-test-proof-inventory] Added {added} new proofs (total: {len(inv)})")

# ── 5. v2-test-proof-map.json ───────────────────────────────────────────
proof_map = load_json("docs/v2-foundation/v2-test-proof-map.json")
existing_tp_v1paths = {m['v1Path'] for m in proof_map}

new_proof_maps = [
    {"v1Path": "apps/platform-api/scripts/metrics-prometheus-runtime-proof.ts", "v2Path": "apps/platform-api/scripts/metrics-prometheus-runtime-proof.ts", "v2Stage": "test", "disposition": "reuse-unchanged", "retirementJustification": None},
    {"v1Path": "apps/platform-api/scripts/dashboards-runtime-proof.ts", "v2Path": "apps/platform-api/scripts/dashboards-runtime-proof.ts", "v2Stage": "test", "disposition": "reuse-unchanged", "retirementJustification": None},
]

added = 0
for m in new_proof_maps:
    if m['v1Path'] not in existing_tp_v1paths:
        proof_map.append(m)
        existing_tp_v1paths.add(m['v1Path'])
        added += 1

save_json("docs/v2-foundation/v2-test-proof-map.json", proof_map)
print(f"[v2-test-proof-map] Added {added} new mappings (total: {len(proof_map)})")

print("\n✓ All registrations complete")
