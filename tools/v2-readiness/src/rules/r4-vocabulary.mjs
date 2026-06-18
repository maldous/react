import {
  FILE_DISPOSITIONS,
  COMMAND_DISPOSITIONS,
  TEST_MIGRATION_TYPES,
  CAPABILITY_STATUSES,
  finding,
} from "../vocab.mjs";

const check = (arr, key, allowed, ruleSubject, out) => {
  for (const e of arr) {
    const v = e[key];
    if (!allowed.includes(v))
      out.push(
        finding(
          "R4-vocabulary",
          `${ruleSubject}: ${e.v1Path || e.v1Name || e.capability || JSON.stringify(e).slice(0, 40)}`,
          `${key} "${v}" is outside the canonical vocabulary`
        )
      );
  }
};

export default function r4Vocabulary(ctx) {
  const out = [];
  check(ctx.pathMap, "disposition", FILE_DISPOSITIONS, "path-map", out);
  check(ctx.commandMap, "disposition", COMMAND_DISPOSITIONS, "command-map", out);
  check(ctx.testMap, "migrationType", TEST_MIGRATION_TYPES, "test-proof-map", out);
  check(ctx.capabilities, "status", CAPABILITY_STATUSES, "capability", out);
  return out;
}
