# Evidence: ADR-ACT-0287 — Complete schema-level OpenAPI drift enforcement

**Date:** 2026-06-17
**Status:** Done
**Action:** ADR-ACT-0287
**ADR Ref:** ADR-0065, ADR-0013

## Summary

ADR-0065 left "complete OpenAPI drift enforcement over request/response
**schemas**" as a Proposed sub-decision: the spec documented only path+method
presence, and 356 responses (228 error + 126 success, non-204) carried a
description but no schema. This slice closes the **schema-presence** dimension:

1. Every documented BFF request body and non-bodyless response now declares a
   schema in `docs/api/openapi.json`.
2. The strict drift gate fails if any future request/response regresses to no
   schema.

**Out of scope (explicitly not claimed):** runtime/semantic conformance — i.e.
asserting that a documented schema matches the live response shape at runtime.
That is contract-testing, a separate future concern, not drift enforcement.

## Implementation

- **Error responses (228):** every 4xx/5xx response references
  `components.schemas.ErrorResponse` (`{code, message, details?}`). Accurate, not
  boilerplate — the BFF pipeline serialises every typed
  `@platform/platform-errors` `AppError` through `toSafeResponse()` into exactly
  this envelope (status→code: 400 `VALIDATION_ERROR`, 401 `UNAUTHORIZED`, 403
  `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT`, 500 `UNEXPECTED_ERROR`, 502
  `INFRASTRUCTURE_ERROR`).
- **Success responses (121):** each 2xx body documented with a schema authored
  strictly from the handler's `res.json(<code>, …)` shape and the backing Zod
  contracts (`contracts-admin`, `authorisation-runtime`, adapters). No invented
  fields; arrays/enums/nullability/required transcribed from source. Added
  `components.schemas.SupportSessionRequest` earlier (ADR-ACT-0286).
- **Status-code drift fixed (5):** `PATCH`/`DELETE /api/org/config/:key`,
  `PATCH /api/org/members/:userId/{status,username}`, and
  `POST /api/org/members/resend-invite` were documented as `200` but the handler
  returns `204 No Content`; corrected to `204`.
- **Gate (`tools/architecture/validate-openapi-drift/src/index.mjs`):** added
  `findSchemalessSchemas` — under `--strict` the tool now fails on any JSON
  request body or non-bodyless response (exempting `204`/`3xx` redirects and
  reusable `$ref` responses) that lacks a schema. Runs in `make architecture`
  (→ `make check`).

## Result

- `node tools/architecture/validate-openapi-drift/src/index.mjs --strict`
  → `OK - 155 route(s) match docs/api/openapi.json`, exit `0`.
- Schemaless responses: **0** (error and success).
- `node --test …/validate-openapi-drift.test.mjs` → **14 pass / 0 fail**,
  including guards that the live spec has zero schemaless bodies and zero
  unresolvable `$ref`s.

## Relationship to ADR-ACT-0250

This closes the "complete OpenAPI drift enforcement" element of ADR-ACT-0250.
The rest of ADR-ACT-0250 (external developer portal/gateway, SDK generation,
sandbox/test mode) remains Open and Proposed under ADR-0065.
