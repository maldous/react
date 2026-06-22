/**
 * Provider-level proof wrapper for backup-restore-scripts.
 *
 * The delegated proof exercises pg_dump/pg_restore script configuration,
 * protected-environment refusal, dump integrity, restore guards, unavailable
 * database failure, and misconfigured restore confirmation failure.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const delegatedProofSource = readFileSync(join(scriptDir, "backup-local-runtime-proof.ts"), "utf8");
const adapterSource = readFileSync(
  join(scriptDir, "../src/adapters/backup-restore-scripts.ts"),
  "utf8"
);
const controlSource = readFileSync(join(scriptDir, "../src/usecases/backup-control.ts"), "utf8");

assert.ok(
  delegatedProofSource.includes("INSERT INTO public.organisations") &&
    delegatedProofSource.includes("SELECT id FROM public.organisations") &&
    delegatedProofSource.includes("DELETE FROM public.organisations"),
  "delegated backup proof must assert database seed/select/delete side effects"
);
assert.ok(
  delegatedProofSource.includes("postgres-backup.sh") &&
    delegatedProofSource.includes("gunzipSync(readFileSync(out))") &&
    delegatedProofSource.includes("dump.includes(marker)") &&
    delegatedProofSource.includes("statSync(out).mode"),
  "delegated backup proof must assert dump creation, integrity marker, and owner-only file state"
);
assert.ok(
  delegatedProofSource.includes("REFUSES ENV=prod") &&
    delegatedProofSource.includes("without CONFIRM_RESTORE") &&
    delegatedProofSource.includes("ON_ERROR_STOP=1") &&
    delegatedProofSource.includes("--single-transaction"),
  "delegated backup proof must assert fail-closed restore refusal and transaction guard failure modes"
);
assert.ok(
  adapterSource.includes("failClosed") &&
    adapterSource.includes("healthCheck") &&
    adapterSource.includes("operatorRecovery"),
  "backup provider adapter must publish fail-closed, health-check, and recovery semantics"
);
assert.ok(
  controlSource.includes('metrics: configured ? "prometheus"') &&
    controlSource.includes('traces: configured ? "tempo"') &&
    controlSource.includes('logs: configured ? "loki"') &&
    controlSource.includes('errorCapture: configured ? "sentry"'),
  "backup control report must expose metric, trace, log, and error-capture status"
);

await import("./backup-local-runtime-proof.ts");
