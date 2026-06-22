/**
 * Provider-ID proof entrypoint for the Postgres profile repository.
 *
 * The substantive live proof is profile-self-service-runtime-proof.ts. It
 * validates tenant/user scoped profile reads and writes through the Postgres
 * repository and route/usecase surface.
 */

import "./profile-self-service-runtime-proof.ts";
