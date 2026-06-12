# ADR-0065: Developer platform and API management architecture

## Status

Proposed

## Date

2026-06-13

## Decision owner

Architecture owner / technical lead

## Consulted

Engineering; product; security; AI assistant (drafting, human review required).

## Context

Webhooks are delivered and proven (ADR-0051/0052). An OpenAPI baseline exists (`docs/api/openapi.json`) but drift enforcement is incomplete, GraphQL is the primary client boundary (ADR-0013), and there are no API keys/PATs, no OAuth-app/service-account self-service, no developer portal, no SDK generation, no rate limits, and no sandbox/test mode.

## Decision

1. **API keys / PATs / service accounts (build):** scoped, hashed, write-only credentials reusing the secret-redaction pattern; per-tenant; audited.
2. **Rate limits + quotas (build):** Redis-backed, entitlement-aware (ADR-0057).
3. **API docs + portal (compose):** Redocly/Swagger UI for docs; Backstage or Kong OSS for a developer portal/gateway if a real need is proven; complete OpenAPI drift enforcement first.
4. **SDK generation + sandbox/test mode (build/defer):** deferred until the API surface and portal stabilise.
5. Mock providers (WireMock/LocalStack/mock-oidc) remain dev/test only.

## Consequences

Positive: self-serve developer experience; reuses webhooks + credential patterns.

Negative: API keys add a high-value secret surface; portal/gateway add operational burden.

Neutral / operational: depends on entitlements for rate-limit/quota tiers.

## Validation / evidence

Evidence level: High (credential surface). New `proof:api-keys` + completed `openapi:drift` required.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0250).

## References

ADR-0013, ADR-0051, ADR-0052, ADR-0053, ADR-0057.

## Notes

Proposed; acceptance requires human review.
