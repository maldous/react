// Identity repository port (ADR-ACT-0141).
// The interface lives in packages/adapters-postgres/src/ports.ts (closest to its
// implementation). This re-export makes it discoverable from the platform-api
// application layer without violating hexagonal boundaries.
export type { IdentityRepository } from "@platform/adapters-postgres";
