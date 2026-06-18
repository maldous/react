import { FILE_DISPOSITIONS, finding } from "../vocab.mjs";

const tally = (arr, key) => arr.reduce((a, e) => ((a[e[key]] = (a[e[key]] || 0) + 1), a), {});

const compare = (label, recomputed, declared, allowedKeys, out) => {
  if (!declared) {
    out.push(finding("R5-count-buckets", label, "reconciliation has no bucket block to compare"));
    return;
  }
  const keys = new Set([...Object.keys(recomputed), ...Object.keys(declared)]);
  for (const k of keys) {
    if (allowedKeys && !allowedKeys.includes(k))
      out.push(
        finding(
          "R5-count-buckets",
          `${label}.${k}`,
          `bucket name "${k}" is not in the canonical vocabulary (alias/collapsed bucket)`
        )
      );
    if ((recomputed[k] || 0) !== (declared[k] || 0))
      out.push(
        finding(
          "R5-count-buckets",
          `${label}.${k}`,
          `count mismatch: source=${recomputed[k] || 0} vs reconciliation=${declared[k] || 0}`
        )
      );
  }
};

export default function r5CountBuckets(ctx) {
  const out = [];
  const r = ctx.reconciliation || {};
  compare("files", tally(ctx.pathMap, "disposition"), r.files?.buckets, FILE_DISPOSITIONS, out);
  compare("commands", tally(ctx.commandMap, "disposition"), r.commands?.buckets, null, out);
  compare("tests", tally(ctx.testMap, "migrationType"), r.tests?.buckets, null, out);
  compare("capabilities", tally(ctx.capabilities, "status"), r.capabilities?.buckets, null, out);
  return out;
}
