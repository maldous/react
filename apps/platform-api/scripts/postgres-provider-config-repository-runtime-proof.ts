/**
 * Provider-ID proof entrypoint for postgres-provider-config-repository.
 *
 * The substantive proof is provider-config-runtime-proof.ts, which validates
 * live provider config put/list/delete, opaque credential refs, secret-policy
 * rejection, production forbiddance, lifecycle degradation, and audit behavior.
 */

import "./provider-config-runtime-proof.ts";
