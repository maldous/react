import { finding } from "../vocab.mjs";

const KNOWN_STAGES = ["dev", "development", "test", "staging", "prod", "production"];

// Dedicated executable/Terraform/Playwright reconciliation (§4) against the generated
// v1-executable-assets inventory, the path-map, the test/proof inventory and the command map.
export default function r19ExecutableAssets(ctx) {
  const out = [];
  const ex = ctx.executableAssets;
  if (!ex) {
    out.push(
      finding(
        "R19-executable-assets",
        "v1-executable-assets.json",
        "missing executable-assets inventory"
      )
    );
    return out;
  }
  // an asset is "tracked" if it is in the audit-base path-map OR recorded as a post-audit addition.
  const mapped = new Set([
    ...ctx.pathMap.map((e) => e.v1Path),
    ...(ctx.postAuditDelta?.additions || []).map((a) => a.path),
  ]);
  const invPaths = new Set((ctx.testInventory || []).map((t) => t.path));
  const cmdNames = new Set(ctx.commandMap.map((c) => c.v1Name));

  // every enumerated executable file must be tracked in the path-map (nothing escapes the V2 mapping)
  for (const f of [
    ...(ex.shellScripts || []),
    ...(ex.nodeScripts || []),
    ...(ex.playwrightConfigs || []),
  ])
    if (!mapped.has(f))
      out.push(finding("R19-executable-assets", f, "executable asset not present in the path-map"));

  // every Playwright spec must be in the test/proof inventory
  for (const s of ex.playwrightSpecs || [])
    if (!invPaths.has(s))
      out.push(
        finding("R19-executable-assets", s, "Playwright spec absent from the test/proof inventory")
      );

  // every Playwright config must be path-mapped and correspond to a named e2e command
  const e2eCommandsExist = [...cmdNames].some((n) => /e2e/i.test(n));
  for (const c of ex.playwrightConfigs || []) {
    if (!mapped.has(c))
      out.push(finding("R19-executable-assets", c, "Playwright config not path-mapped"));
    if (!e2eCommandsExist)
      out.push(
        finding("R19-executable-assets", c, "no e2e command invokes the Playwright projects")
      );
  }

  // every Terraform root must have a main.tf and a recognised stage classification
  for (const root of ex.terraformRoots || []) {
    const stage = root.split("/").pop();
    if (!mapped.has(`${root}/main.tf`))
      out.push(
        finding("R19-executable-assets", root, "Terraform root has no main.tf in the path-map")
      );
    if (!KNOWN_STAGES.includes(stage))
      out.push(
        finding(
          "R19-executable-assets",
          root,
          `Terraform root "${stage}" is not a recognised environment`
        )
      );
  }
  // every Terraform module must be path-mapped (consumed by a root or retained)
  for (const mod of ex.terraformModules || [])
    if (!mapped.has(`${mod}/main.tf`))
      out.push(
        finding("R19-executable-assets", mod, "Terraform module has no main.tf in the path-map")
      );

  // command-map entries that name a script/executable target must resolve to a tracked file
  for (const c of ctx.commandMap) {
    const target = c.v2Location || "";
    const m = /([\w./-]+\.(?:sh|mjs|ts|js))\b/.exec(target);
    if (m && !mapped.has(m[1]) && !ctx.fileExists?.(m[1]))
      out.push(
        finding(
          "R19-executable-assets",
          c.v1Name,
          `command target "${m[1]}" does not resolve to a tracked file`
        )
      );
  }
  return out;
}
