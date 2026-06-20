import fs from "node:fs";
import path from "node:path";
import { finding } from "../vocab.mjs";
import { validateHarnessDefinitions } from "../../../ui-reference-harness/src/validate-definition.mjs";

// R20 — Semantic Reference Harness consistency. Every capability in ui-capability-model.json that
// carries a `harness` block must be internally consistent (declared states/commands/permissions/
// fixtures/journeys cross-reference correctly) and must not ship bespoke per-capability code. This
// is the dedicated harness validator surface — deliberately separate from R14, which only
// presence-checks the base capability schema. Capabilities without a harness block are ignored.
function listSourceFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

export default function r20HarnessSemantics(ctx) {
  const model = ctx.foundation?.["ui-capability-model.json"];
  if (!model || !Array.isArray(model.capabilities)) return [];
  // No harness-enabled capability → nothing to validate (and no need to touch the filesystem).
  if (!model.capabilities.some((c) => c && c.harness)) return [];

  const srcDir = path.join(ctx.repoRoot, "tools/ui-reference-harness/src");
  let packageScripts = {};
  try {
    packageScripts = JSON.parse(
      fs.readFileSync(path.join(ctx.repoRoot, "package.json"), "utf8")
    ).scripts;
  } catch {
    packageScripts = {};
  }

  return validateHarnessDefinitions(model.capabilities, {
    sourceFiles: listSourceFiles(srcDir),
    packageScripts,
    exceptions: [],
  }).map((f) => finding("R20-harness-semantics", f.capabilityKey, f.message));
}
