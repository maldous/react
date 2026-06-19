import { finding } from "../vocab.mjs";

const FORBIDDEN = /\bapps\/api\b/;

// Parse the annotated tree into normalised full paths by reconstructing a depth stack from the
// box-drawing indentation (each level = 4 display columns; the connector is ├──/└──).
export function parseTreePaths(text) {
  const paths = new Set();
  const stack = [];
  for (const line of text.split("\n")) {
    const connIdx = line.search(/[├└]/);
    if (connIdx < 0) continue;
    const m = /[├└]──\s+(.+)/.exec(line);
    if (!m) continue;
    const depth = Math.round(connIdx / 4);
    let name = m[1].split("#")[0].trim().replace(/\/$/, "");
    if (!name) continue;
    stack[depth] = name;
    stack.length = depth + 1;
    paths.add(stack.join("/"));
  }
  return paths;
}

// Exact agreement on application roots across the tree, contracts, path-map, test-map, command-map and
// runbook. App roots are DERIVED from the tree (children of `apps/`), not hard-coded — generalised to
// however many app roots exist. `apps/api` (the abandoned rename) must appear nowhere.
export default function r15AppPath(ctx) {
  const out = [];
  const treePaths = parseTreePaths(ctx.targetTree);
  const treeAppRoots = new Set([...treePaths].filter((p) => /^apps\/[^/]+$/.test(p)));

  // forbidden abandoned root
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

  if (treeAppRoots.size === 0) {
    out.push(
      finding(
        "R15-app-path",
        "v2-target-tree.txt",
        "no application roots parsed from the tree under apps/"
      )
    );
    return out;
  }

  // every app-root referenced elsewhere must be one the tree declares
  const appRootOf = (p) => (/^(apps\/[^/]+)(\/|$)/.exec(p || "") || [])[1];
  const reconcile = (subject, paths) => {
    for (const r of new Set(paths.map(appRootOf).filter(Boolean)))
      if (!treeAppRoots.has(r))
        out.push(
          finding("R15-app-path", subject, `app root "${r}" is not declared in the V2 target tree`)
        );
  };
  reconcile("v1-to-v2-path-map.json", ctx.pathMap.map((e) => e.v2Path).filter(Boolean));
  reconcile("v2-test-proof-map.json", ctx.testMap.map((e) => e.v2Path).filter(Boolean));
  reconcile(
    "v2-directory-contracts.json",
    ctx.directoryContracts.map((c) => c.path)
  );

  // every tree app root must have a directory contract (exact, not substring)
  const contractPaths = new Set(ctx.directoryContracts.map((c) => c.path));
  for (const r of treeAppRoots)
    if (!contractPaths.has(r) && ![...contractPaths].some((p) => p.startsWith(r + "/")))
      out.push(
        finding(
          "R15-app-path",
          "v2-directory-contracts.json",
          `tree app root ${r} has no directory contract`
        )
      );
  return out;
}
