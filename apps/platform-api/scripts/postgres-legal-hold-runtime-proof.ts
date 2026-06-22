/**
 * Provider-ID proof entrypoint for the Postgres legal-hold repository.
 *
 * The substantive proof lives in legal-hold-runtime-proof.ts and exercises
 * set/release lifecycle, audit-before-change, active-hold guard behavior,
 * released-state listing, and the deletion no-go invariant that downstream
 * retention/storage consumers depend on.
 */

import "./legal-hold-runtime-proof.ts";
