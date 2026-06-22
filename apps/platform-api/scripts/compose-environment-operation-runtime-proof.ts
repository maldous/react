/**
 * Provider-ID proof entrypoint for the compose environment operation adapter.
 *
 * The substantive proof lives in environment-operations-runtime-proof.ts and exercises
 * the closed operation enum, argv-only dry runs, profile/mock restrictions, non-destructive
 * stop/restart behavior, pattern validation, permission checks, and audit emission.
 */

import "./environment-operations-runtime-proof.ts";
