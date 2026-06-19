import { finding } from "../vocab.mjs";

const stripName = (n) => n.replace(/^(make |npm run |npm )/, "");

// Independent command coverage: live Make targets + npm scripts must each be catalogued AND mapped;
// no duplicates; no stale catalogue entries; merge/retire carry a retireReason.
export default function r11CommandCoverage(ctx) {
  const out = [];
  const catByName = {};
  for (const c of ctx.commandCatalog) catByName[c.name] = (catByName[c.name] || 0) + 1;
  for (const [n, k] of Object.entries(catByName))
    if (k > 1) out.push(finding("R11-command-coverage", n, `duplicate catalogue entry (${k}x)`));

  const cataloguedScripts = new Set(ctx.commandCatalog.map((c) => stripName(c.name)));
  const catalogueMake = new Set(
    ctx.commandCatalog.filter((c) => c.kind === "make").map((c) => stripName(c.name))
  );
  const mapNames = new Set(ctx.commandMap.map((c) => c.v1Name));

  // every live make target catalogued + mapped; no stale catalogue make target
  const liveMake = new Set(ctx.makeTargets);
  for (const t of liveMake) {
    if (!catalogueMake.has(t))
      out.push(
        finding(
          "R11-command-coverage",
          `make ${t}`,
          "live Make target missing from command catalogue"
        )
      );
    if (!mapNames.has(`make ${t}`))
      out.push(
        finding("R11-command-coverage", `make ${t}`, "live Make target missing from command map")
      );
  }
  for (const t of catalogueMake)
    if (!liveMake.has(t))
      out.push(
        finding(
          "R11-command-coverage",
          `make ${t}`,
          "catalogued Make target no longer exists (stale)"
        )
      );

  // every live npm script catalogued + mapped
  const liveNpm = new Set(Object.keys(ctx.packageJsonScripts));
  for (const s of liveNpm) {
    if (!cataloguedScripts.has(s))
      out.push(
        finding(
          "R11-command-coverage",
          `npm ${s}`,
          "live npm script missing from command catalogue"
        )
      );
    if (!mapNames.has(`npm ${s}`))
      out.push(
        finding("R11-command-coverage", `npm ${s}`, "live npm script missing from command map")
      );
  }
  // stale npm/compose catalogue entries (script gone)
  for (const c of ctx.commandCatalog) {
    if ((c.kind === "npm" || c.kind === "compose") && !liveNpm.has(stripName(c.name)))
      out.push(
        finding(
          "R11-command-coverage",
          c.name,
          "catalogued npm/compose script no longer exists (stale)"
        )
      );
  }
  // full catalogue <-> map bijection across ALL kinds (make/npm/compose/node/shell), both directions
  const catNames = new Set(ctx.commandCatalog.map((c) => c.name));
  const mapV1 = ctx.commandMap.map((c) => c.v1Name);
  const mapNameSet = new Set(mapV1);
  for (const n of catNames)
    if (!mapNameSet.has(n))
      out.push(finding("R11-command-coverage", n, "catalogue command has no command-map entry"));
  for (const n of mapNameSet)
    if (!catNames.has(n))
      out.push(finding("R11-command-coverage", n, "command-map entry has no catalogue command"));
  // duplicate map names
  const seen = new Set();
  for (const n of mapV1) {
    if (seen.has(n)) out.push(finding("R11-command-coverage", n, "duplicate command-map v1Name"));
    seen.add(n);
  }
  // merge target must resolve to a surviving command
  for (const c of ctx.commandMap) {
    if (c.disposition === "merge" && c.v2Name && !mapNameSet.has(c.v2Name))
      out.push(
        finding(
          "R11-command-coverage",
          c.v1Name,
          `merge target "${c.v2Name}" is not a known command`
        )
      );
    if ((c.disposition === "merge" || c.disposition === "retire") && !c.retireReason)
      out.push(
        finding("R11-command-coverage", c.v1Name, `${c.disposition} without a retireReason`)
      );
  }
  return out;
}
