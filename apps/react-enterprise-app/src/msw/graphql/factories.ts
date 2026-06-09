import type {
  OrganisationProfileQuery,
  UpdateOrganisationProfileMutation,
} from "@platform/contracts-graphql";
import { organisationFixture } from "../fixtures/organisation.ts";

// GraphQL mock factories keyed by generated operation name (ADR-ACT-0203). A
// resolver returns a full GraphQL response body ({ data } or { errors }) so a
// test can model success and GraphQL-level errors per operation. The operation
// name is read from the request — by operationName when present, else parsed
// from the query text — so we never import the `graphql` runtime into the SPA.

export interface GraphqlMockContext {
  variables: Record<string, unknown>;
  operationName: string | null;
}

export interface GraphqlResponseBody {
  data?: unknown;
  errors?: Array<{ message: string }>;
}

export type GraphqlResolver = (ctx: GraphqlMockContext) => GraphqlResponseBody;

const OPERATION_NAME_RE = /\b(?:query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/;

export function operationNameFromQuery(query: string): string | null {
  const match = OPERATION_NAME_RE.exec(query);
  return match ? (match[1] ?? null) : null;
}

// Default resolvers — happy path for every known operation. Typed against the
// generated operation result types so a schema/operation change surfaces here.
export const defaultGraphqlResolvers: Record<string, GraphqlResolver> = {
  OrganisationProfile: (): GraphqlResponseBody => {
    const data: OrganisationProfileQuery = { organisationProfile: organisationFixture };
    return { data };
  },
  UpdateOrganisationProfile: ({ variables }): GraphqlResponseBody => {
    const data: UpdateOrganisationProfileMutation = {
      updateOrganisationProfile: {
        ...organisationFixture,
        displayName: String(variables["displayName"] ?? organisationFixture.displayName),
      },
    };
    return { data };
  },
};

/** A resolver that returns a GraphQL-level error for any operation. */
export function graphqlErrorResolver(message: string): GraphqlResolver {
  return () => ({ errors: [{ message }] });
}
