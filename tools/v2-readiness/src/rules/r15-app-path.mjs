import { finding } from "../vocab.mjs";

// The tree, maps, contracts and runbook must agree on the V2 application roots. V2 keeps the V1
// names: apps/platform-api + apps/web. apps/api (the abandoned rename) must appear nowhere.
const CANONICAL = ["apps/platform-api", "apps/web"];
const FORBIDDEN = /\bapps\/api\b/;

export default function r15AppPath(ctx) {
  const out = [];
  const check = (subject, text) => {
    if (typeof text === "string" && FORBIDDEN.test(text))
      out.push(
        finding(
          "R15-app-path",
          subject,
          "references the abandoned app root apps/api (V2 keeps apps/platform-api)"
        )
      );
  };
  check("v2-target-tree.txt", ctx.targetTree);
  check("v2-branch-cut-runbook.md", ctx.runbook);
  check("v1-to-v2-path-map.json", JSON.stringify(ctx.pathMap.map((e) => e.v2Path)));
  check("v2-test-proof-map.json", JSON.stringify(ctx.testMap.map((e) => e.v2Path)));
  check("v2-command-map.json", JSON.stringify(ctx.commandMap));
  check("v2-directory-contracts.json", JSON.stringify(ctx.directoryContracts));

  // the canonical app roots must be present in the tree and directory contracts (agreement, not silence)
  const contractPaths = ctx.directoryContracts.map((c) => c.path);
  for (const root of CANONICAL) {
    if (!ctx.targetTree.includes(root.split("/")[1]))
      out.push(
        finding(
          "R15-app-path",
          "v2-target-tree.txt",
          `canonical app root ${root} absent from the tree`
        )
      );
    if (!contractPaths.some((p) => p === root || p.startsWith(root + "/")))
      out.push(
        finding(
          "R15-app-path",
          "v2-directory-contracts.json",
          `canonical app root ${root} has no directory contract`
        )
      );
  }
  return out;
}
