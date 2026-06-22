/**
 * Provider-ID proof entrypoint for postgres-data-governance.
 *
 * The substantive proof is data-governance-runtime-proof.ts, which exercises the
 * catalogue, classification, DSR open-to-fulfilled workflow, fulfilment evidence,
 * and governance route registration. This wrapper gives the Postgres provider a
 * stable proof identity for V2 assurance mapping.
 */

import "./data-governance-runtime-proof.ts";
