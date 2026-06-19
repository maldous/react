import { finding } from "../vocab.mjs";

// Independent test/proof coverage: live test files must be inventoried; inventory paths must resolve
// (file exists, or package.json#script exists); test-map records must map an inventory entry; retire
// needs justification.
export default function r12TestCoverage(ctx) {
  const out = [];
  const invPaths = new Set(ctx.testInventory.map((t) => t.path));

  // live test files inventoried
  const live = ctx.listTestFiles?.();
  if (live) {
    for (const f of live)
      if (!invPaths.has(f))
        out.push(
          finding("R12-test-coverage", f, "live test file missing from test-proof inventory")
        );
  } else {
    out.push(
      finding(
        "R12-test-coverage",
        "git",
        "could not list live test files; coverage not independently verified",
        "warning"
      )
    );
  }

  // every inventory path resolves
  for (const t of ctx.testInventory) {
    const p = t.path;
    if (p.includes("#")) {
      const script = p.split("#")[1];
      if (!ctx.packageJsonScripts[script])
        out.push(finding("R12-test-coverage", p, "proof script not present in package.json"));
    } else if (ctx.fileExists && !ctx.fileExists(p)) {
      out.push(finding("R12-test-coverage", p, "inventoried test path does not exist (dangling)"));
    }
  }

  // every proof:* npm script is inventoried as a proof (§6 proof bijection)
  for (const s of Object.keys(ctx.packageJsonScripts))
    if (/^proof:/.test(s) && !invPaths.has(`package.json#${s}`))
      out.push(
        finding(
          "R12-test-coverage",
          `package.json#${s}`,
          "proof:* script missing from the test-proof inventory"
        )
      );

  // duplicate inventory paths
  if (invPaths.size !== ctx.testInventory.length)
    out.push(
      finding("R12-test-coverage", "v1-test-proof-inventory.json", "duplicate inventory paths")
    );

  // test-map records map an inventory entry; carry needs a v2Target; retire justified; map↔inventory both ways
  const mapPaths = new Set(ctx.testMap.map((m) => m.v1Path));
  for (const m of ctx.testMap) {
    if (!invPaths.has(m.v1Path))
      out.push(
        finding(
          "R12-test-coverage",
          m.v1Path,
          "test-map record has no matching inventory entry (dangling)"
        )
      );
    if (m.migrationType !== "retire" && m.v2Path == null)
      out.push(
        finding(
          "R12-test-coverage",
          m.v1Path,
          `migrationType ${m.migrationType} but v2Path is null`
        )
      );
    if (m.migrationType === "retire" && !m.retirementJustification)
      out.push(finding("R12-test-coverage", m.v1Path, "retire without retirementJustification"));
  }
  for (const t of ctx.testInventory)
    if (!mapPaths.has(t.path))
      out.push(
        finding("R12-test-coverage", t.path, "inventory entry missing from the test-proof map")
      );
  return out;
}
