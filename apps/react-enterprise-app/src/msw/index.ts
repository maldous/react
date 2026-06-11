// Public entry for the SPA test mock substrate (ADR-0019). Frontend tests import
// the shared `server` plus handler factories and fixtures from here; the global
// lifecycle (listen/reset/close) is owned by src/test-setup.ts.
export { server } from "./server.ts";
export {
  handlers,
  sessionHandler,
  sessionErrorHandler,
  themeHandler,
  themeErrorHandler,
  providersHandler,
  providersEmptyHandler,
  providersErrorHandler,
  networkErrorHandler,
  adminMembersHandler,
  adminFeaturesHandler,
  adminAuthProvidersHandler,
  adminIdpsHandler,
  adminMfaHandler,
  adminSessionPolicyHandler,
  adminAuthReadinessHandler,
  adminExternalIdentitiesHandler,
  adminConfigHandler,
  adminAuditHandler,
  adminReadinessHandler,
  adminGetErrorHandler,
  adminWriteOkHandlers,
} from "./handlers.ts";
export {
  membersFixture,
  featuresFixture,
  authProvidersFixture,
  idpsFixture,
  mfaFixture,
  sessionPolicyFixture,
  authReadinessFixture,
  externalIdentitiesFixture,
  configFixture,
  auditFixture,
  tenantReadinessFixture,
  tenantReadinessBlockedFixture,
} from "./fixtures/admin.ts";
export {
  createGraphqlHandler,
  graphqlTransportErrorHandler,
  graphqlNetworkErrorHandler,
} from "./graphql/handlers.ts";
export {
  defaultGraphqlResolvers,
  graphqlErrorResolver,
  operationNameFromQuery,
  type GraphqlResolver,
  type GraphqlMockContext,
  type GraphqlResponseBody,
} from "./graphql/factories.ts";
export { sessionFixtures, actorFor, type SessionPersona } from "./fixtures/session.ts";
export { organisationFixture } from "./fixtures/organisation.ts";
export { defaultThemeFixture, tenantThemeFixture, type ThemeFixture } from "./fixtures/theme.ts";
export { providersFixture, platformOnlyProvidersFixture } from "./fixtures/providers.ts";
