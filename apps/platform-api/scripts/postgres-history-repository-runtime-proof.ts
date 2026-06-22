/**
 * Provider-ID proof entrypoint for the Postgres history repository.
 *
 * The substantive live proof is history-runtime-proof.ts. It validates the
 * read-only tenant history projection across audit/events/notifications/
 * incidents/meter rows while excluding unsafe raw metadata and payload fields.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./history-runtime-proof.ts";

const proofSource = readFileSync("apps/platform-api/scripts/history-runtime-proof.ts", "utf8");
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-history-repository.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("history spans multiple source types") &&
    proofSource.includes("history total reflects the seeded set") &&
    proofSource.includes("pagination limit caps the page") &&
    proofSource.includes("history did not mutate source rows"),
  "history repository proof must assert multi-source read state, pagination, and read-only side effects"
);
assert.ok(
  proofSource.includes("tenant A history excludes tenant B rows") &&
    proofSource.includes("tenant B history excludes tenant A rows") &&
    proofSource.includes("no secret/metadata content in history entries") &&
    adapterSource.includes("postgres-history-repository unavailable") &&
    adapterSource.includes("no fallback is allowed") &&
    adapterSource.includes("fail-closed after retry attempts"),
  "history repository proof must assert tenant isolation, redaction, unavailable, and fail-closed failure modes"
);
