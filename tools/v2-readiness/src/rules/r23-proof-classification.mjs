import { finding } from "../vocab.mjs";

const PROOF_SCRIPT_RE = /^apps\/platform-api\/scripts\/.*(?:proof|runtime-proof).*\.ts$/;
const VALID_LEVELS = new Set([0, 1, 2, 3, 4, 5]);

const present = (v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0);

function scriptPathForInventoryRecord(record, packageJsonScripts = {}) {
  const p = record.path || record.id || "";
  if (PROOF_SCRIPT_RE.test(p)) return p;
  if (!p.startsWith("package.json#")) return null;
  const scriptName = p.slice("package.json#".length);
  const cmd = packageJsonScripts[scriptName] || "";
  const match = cmd.match(/apps\/platform-api\/scripts\/[^\s"'`]+\.ts/);
  return match ? match[0] : null;
}

// R23 implements the proof-strength audit from the objective: every runtime proof script must be
// inventoried and classified at Level 0..5 with rationale, so "proof" is no longer an ambiguous word.
export default function r23ProofClassification(ctx) {
  const out = [];
  const candidateScripts = new Set(
    (ctx.candidateTracked?.files || []).filter((file) => PROOF_SCRIPT_RE.test(file))
  );
  const classifiedScripts = new Set();

  for (const record of ctx.testInventory || []) {
    const scriptPath = scriptPathForInventoryRecord(record, ctx.packageJsonScripts);
    if (!scriptPath) continue;
    classifiedScripts.add(scriptPath);
    if (!VALID_LEVELS.has(record.proofLevel))
      out.push(
        finding(
          "R23-proof-classification",
          record.path || record.id || scriptPath,
          "runtime proof inventory entry must declare proofLevel 0..5"
        )
      );
    if (!present(record.proofLevelRationale))
      out.push(
        finding(
          "R23-proof-classification",
          record.path || record.id || scriptPath,
          "runtime proof inventory entry must declare proofLevelRationale"
        )
      );
  }

  for (const scriptPath of candidateScripts)
    if (!classifiedScripts.has(scriptPath))
      out.push(
        finding(
          "R23-proof-classification",
          scriptPath,
          "runtime proof script is not represented in v1-test-proof-inventory.json"
        )
      );

  return out;
}
