import { finding } from "../vocab.mjs";

// Live migrations + persistent-data ⇆ data-and-migration-plan reconciliation (§3).
export default function r17Migrations(ctx) {
  const out = [];
  const plan = ctx.foundation?.["data-and-migration-plan.json"];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    out.push(
      finding("R17-migrations", "data-and-migration-plan.json", "missing or malformed data plan")
    );
    return out;
  }
  const chain = plan.postgres?.migrationChain || [];
  const planned = new Map(chain.map((m) => [m.file, m]));
  const onDisk = ctx.migrations || [];
  const diskFiles = new Set(onDisk.map((m) => m.file));

  // bijection: every on-disk migration is planned, and every planned migration exists on disk
  for (const m of onDisk)
    if (!planned.has(m.file))
      out.push(
        finding(
          "R17-migrations",
          m.file,
          "on-disk migration absent from the data-and-migration-plan migrationChain"
        )
      );
  for (const f of planned.keys())
    if (!diskFiles.has(f))
      out.push(finding("R17-migrations", f, "planned migration has no file on disk"));

  // ordering: migrationChain must be sorted by leading sequence (historical migrations are immutable-carry)
  const seqs = chain.map((m) => parseInt((m.file.match(/^(\d+)/) || [])[1] || "0", 10));
  for (let i = 1; i < seqs.length; i++)
    if (seqs[i] < seqs[i - 1])
      out.push(finding("R17-migrations", chain[i].file, "migrationChain out of sequence order"));

  // each planned migration carries its reasoning (intent) so it can't be a silent/unclassified edit
  for (const m of chain)
    if (!m.intent)
      out.push(
        finding("R17-migrations", m.file, "migrationChain entry missing intent classification")
      );

  // every tenant-data-bearing service (tenantData === true) must carry a backup/restore/retention
  // decision in the service matrix. Dev/observability-tool services (tenantData false) are out of scope.
  const matrix = ctx.foundation?.["service-and-clickthrough-matrix.json"] || [];
  const present = (v) => v != null && v !== "" && !/^(n\/a|none)\b/i.test(String(v));
  for (const s of matrix)
    if (s.tenantData === true && !present(s.backupRestore))
      out.push(
        finding(
          "R17-migrations",
          s.id,
          "tenant-data service has no backup/restore/retention decision"
        )
      );

  // the plan must declare a fresh-install baseline and forward-only V2 posture
  if (!plan.v2FreshInstallBaseline)
    out.push(
      finding(
        "R17-migrations",
        "data-and-migration-plan.json",
        "no v2FreshInstallBaseline declared"
      )
    );
  if (!plan.postgres?.schemaMigrationsTable)
    out.push(
      finding(
        "R17-migrations",
        "data-and-migration-plan.json",
        "no schema_migrations tracking declared"
      )
    );
  return out;
}
