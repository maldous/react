/**
 * Provider-ID proof entrypoint for the ClamAV antivirus adapter.
 *
 * The substantive storage proof is tenant-storage-objects-runtime-proof.ts. It
 * validates quarantined uploads, quota-before-write, blocked downloads until a
 * clean scan, EICAR rejection, legal-hold delete denial, live ClamAV clean and
 * rejected verdicts, provider readiness, fail-closed unavailable-provider
 * behaviour, and live MinIO object flow.
 */

import "./tenant-storage-objects-runtime-proof.ts";
