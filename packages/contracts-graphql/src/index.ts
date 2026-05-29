export const packageName = "@platform/contracts-graphql";

export const BASE_SCHEMA_SDL = `
  type Query {
    health: HealthStatus!
    organisation(id: ID!): Organisation
  }

  type Mutation {
    updateOrganisationDisplayName(id: ID!, displayName: String!): Organisation
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
