# E2E failure-rootcause — staging

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=275bfe39-3d89-45a2-8d69-f29bdc9e6647)
- Root-cause proven: 21 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=static_permission_denied, traceId=1d358d7d022201edc34b03b8ca038e16).
