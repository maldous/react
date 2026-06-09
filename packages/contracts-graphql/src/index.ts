export const packageName = "@platform/contracts-graphql";

// Application data flows through GraphQL per ADR-0013. Profile operations are
// session-scoped (ADR-ACT-0199): the BFF derives the organisation from the
// authenticated session, so neither query nor mutation accepts a client-supplied
// id — this prevents cross-tenant IDOR. The Organisation type mirrors
// @platform/contracts-organisation OrganisationProfileSchema exactly.
export const BASE_SCHEMA_SDL = `
  type Query {
    health: HealthStatus!
    organisationProfile: Organisation
  }

  type Mutation {
    updateOrganisationProfile(displayName: String!): Organisation
  }

  type HealthStatus {
    status: String!
  }

  type Organisation {
    id: ID!
    slug: String!
    displayName: String!
    createdAt: String!
    updatedAt: String!
  }
`;

export function buildBaseTypeDefs(): string {
  return BASE_SCHEMA_SDL;
}

export interface GraphQLOperation {
  query: string;
  operationName?: string;
  variables?: Record<string, unknown>;
}

export interface GraphQLResult<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; locations?: unknown[]; path?: unknown[] }>;
}

// Generated TypedDocumentNode operation artifacts (ADR-ACT-0203). Authored in
// ./operations/*.graphql, emitted by `npm run codegen`. Browser-safe: the
// generated module imports only the type-only @graphql-typed-document-node/core
// and inlines the operation AST — it never pulls in the `graphql` runtime.
// Feature hooks import these documents and pass them to the approved browser
// client (@platform/graphql-browser-client); feature components never touch them.
export * from "./generated/graphql.ts";
