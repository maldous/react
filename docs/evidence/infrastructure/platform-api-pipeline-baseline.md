# Platform API Pipeline Baseline Evidence

**Date:** 2026-05-28
**ADR references:** ADR-ACT-0116, ADR-0011, ADR-0013

## Summary

Minimal routing/pipeline layer (`apps/platform-api/src/server/pipeline.ts`) added to the
platform-api HTTP server. Replaces the previous inline routing with a typed, testable pipeline
that supports authentication guards, permission checks, and safe error serialisation.

## Implementation

- `apps/platform-api/src/server/pipeline.ts` — `createRouter()`, `parseJsonBody()`,
  `jsonResponse()`, `generateRequestId()`, `Route`, `PipelineRequest`, `PipelineResponse` types.
- `apps/platform-api/src/server/http.ts` — updated to use `createRouter` from pipeline.ts.

## Capabilities implemented

| Capability | Detail |
| ---------- | ------ |
| Request ID | UUID generated per request, returned as `X-Request-Id` header |
| JSON body parsing | Streams request body; 400 on malformed JSON |
| Route matching | Exact path match; 404 on unknown path; 405 on wrong method |
| Auth guard | `requiresAuth` flag checks `getFixtureSession()`; 401 if no session |
| Permission guard | `requiredPermission` field; 403 if permission missing |
| Safe error serialisation | Handler exceptions caught; `toSafeResponse()` strips internal details |
| CORS | `Access-Control-Allow-Origin: *` on all responses; OPTIONS → 204 |
| Structured logging | `createLogger` from `@platform/platform-logging`; child logger per request |

## Tests

Location: `apps/platform-api/tests/substrate/api-pipeline.test.ts`

8 tests covering all pipeline branches:

1. 404 for unknown path
2. 405 for wrong method
3. Malformed JSON body → 400
4. `requiresAuth=true` without session → 401
5. `requiresAuth=true` with session but missing permission → 403
6. Successful handler → 200
7. Handler that throws → 500, no internal details leaked
8. `X-Request-Id` header present in response

## Gate compliance

- ADR-0011: Tool execution model followed (node:test, self-contained)
- ADR-0012: Tests use node:test with real HTTP server on port 0
- ADR-0013: API boundary defined; pipeline handles auth before business logic
