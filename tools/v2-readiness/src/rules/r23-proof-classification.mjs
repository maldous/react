import { finding } from "../vocab.mjs";
import {
  VALID_ENVIRONMENTS,
  VALID_PROOF_LEVELS,
  VALID_PROVIDER_CLASSES,
  present,
} from "./quality.mjs";

const PROOF_SCRIPT_RE = /^apps\/platform-api\/scripts\/.*(?:proof|runtime-proof).*\.ts$/;
const MIN_DELIVERED_CAPABILITY_PROOF_LEVEL = 3;
const MIN_LIVE_PROVIDER_PROOF_LEVEL = 4;
const LIVE_PROVIDER_TIERS = new Set([
  "live-substrate",
  "live-composed-provider",
  "external-production",
]);

function proofLevelsFromText(text) {
  if (typeof text !== "string") return [];
  const levels = [];
  for (const match of text.matchAll(/\b[Pp]roof levels?:\s*([^.]*)/g)) {
    for (const level of match[1].matchAll(/[0-6]/g)) levels.push(Number(level[0]));
  }
  return levels;
}

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
// inventoried and classified at Level 0..6 with rationale, so "proof" is no longer an ambiguous word.
export default function r23ProofClassification(ctx) {
  const out = [];
  const candidateScripts = new Set(
    (ctx.candidateTracked?.files || []).filter((file) => PROOF_SCRIPT_RE.test(file))
  );
  const classifiedScripts = new Set();

  for (const record of ctx.testInventory || []) {
    const subject = record.path || record.id || "<proof>";
    for (const field of [
      "proofLevel",
      "proofLevelRationale",
      "capabilitiesProven",
      "semanticFacetsProven",
      "environment",
      "providerClass",
      "liveSubstrateUsed",
      "destructive",
      "prodSafe",
      "sourceCommand",
      "expectedFailureMode",
    ])
      if (!present(record[field]))
        out.push(
          finding("R23-proof-classification", subject, `proof inventory missing "${field}"`)
        );
    if (!VALID_PROOF_LEVELS.has(record.proofLevel))
      out.push(
        finding(
          "R23-proof-classification",
          subject,
          "proof inventory entry must declare proofLevel 0..6"
        )
      );
    if (present(record.environment) && !VALID_ENVIRONMENTS.has(record.environment))
      out.push(finding("R23-proof-classification", subject, "proof environment is invalid"));
    if (present(record.providerClass) && !VALID_PROVIDER_CLASSES.has(record.providerClass))
      out.push(finding("R23-proof-classification", subject, "proof providerClass is invalid"));
    if (record.prodSafe === true && record.destructive === true)
      out.push(
        finding("R23-proof-classification", subject, "destructive proof cannot be marked prodSafe")
      );
    if (record.destructive === true && record.environment === "prod")
      out.push(
        finding(
          "R23-proof-classification",
          subject,
          "destructive proof must be dev/test/staging only"
        )
      );

    const scriptPath = scriptPathForInventoryRecord(record, ctx.packageJsonScripts);
    if (!scriptPath) continue;
    classifiedScripts.add(scriptPath);
    if (!VALID_PROOF_LEVELS.has(record.proofLevel))
      out.push(
        finding(
          "R23-proof-classification",
          record.path || record.id || scriptPath,
          "runtime proof inventory entry must declare proofLevel 0..6"
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

  for (const capability of ctx.capabilities || []) {
    if (capability.status !== "delivered-and-proven") continue;
    const levels = proofLevelsFromText(capability.semanticCompleteness?.proof);
    const subject = capability.capability || "<capability>";
    if (levels.length === 0) {
      out.push(
        finding(
          "R23-proof-classification",
          subject,
          "delivered-and-proven capability semantic proof must declare Proof level 3..5"
        )
      );
      continue;
    }
    const maxLevel = Math.max(...levels);
    if (maxLevel < MIN_DELIVERED_CAPABILITY_PROOF_LEVEL)
      out.push(
        finding(
          "R23-proof-classification",
          subject,
          `delivered-and-proven capability proof level ${maxLevel} is below required minimum ${MIN_DELIVERED_CAPABILITY_PROOF_LEVEL}`
        )
      );
    if (LIVE_PROVIDER_TIERS.has(capability.proofTier) && maxLevel < MIN_LIVE_PROVIDER_PROOF_LEVEL)
      out.push(
        finding(
          "R23-proof-classification",
          subject,
          `provider-backed delivered capability proof level ${maxLevel} is below required minimum ${MIN_LIVE_PROVIDER_PROOF_LEVEL}`
        )
      );
  }

  return out;
}
