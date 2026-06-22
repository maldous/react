/**
 * Provider-ID proof entrypoint for the Postgres storage object repository.
 *
 * The substantive storage proof is tenant-storage-objects-runtime-proof.ts. It
 * validates storage object metadata lifecycle, quota-before-write, quarantine,
 * scan promotion/rejection, legal-hold delete denial, and live object flow.
 */

import "./tenant-storage-objects-runtime-proof.ts";
