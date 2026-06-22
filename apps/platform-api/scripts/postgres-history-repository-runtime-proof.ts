/**
 * Provider-ID proof entrypoint for the Postgres history repository.
 *
 * The substantive live proof is history-runtime-proof.ts. It validates the
 * read-only tenant history projection across audit/events/notifications/
 * incidents/meter rows while excluding unsafe raw metadata and payload fields.
 */

import "./history-runtime-proof.ts";
