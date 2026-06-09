import { http, HttpResponse } from "msw";
import {
  defaultGraphqlResolvers,
  operationNameFromQuery,
  type GraphqlResolver,
} from "./factories.ts";

const GRAPHQL_ENDPOINT = "/api/graphql";

interface GraphqlRequestBody {
  query?: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

/**
 * /api/graphql handler dispatching by generated operation name. Pass `overrides`
 * to replace resolvers for specific operations in a single test; unspecified
 * operations fall back to the happy-path defaults.
 */
export function createGraphqlHandler(overrides: Record<string, GraphqlResolver> = {}) {
  const resolvers = { ...defaultGraphqlResolvers, ...overrides };
  return http.post(GRAPHQL_ENDPOINT, async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as GraphqlRequestBody;
    const operationName =
      (typeof body.operationName === "string" ? body.operationName : null) ??
      operationNameFromQuery(body.query ?? "");
    const resolver = operationName ? resolvers[operationName] : undefined;
    if (!resolver) {
      return HttpResponse.json({
        errors: [{ message: `No GraphQL mock for operation: ${operationName ?? "<unknown>"}` }],
      });
    }
    return HttpResponse.json(resolver({ variables: body.variables ?? {}, operationName }));
  });
}

/** Transport-level failure (auth/validation) for GraphQL — non-2xx safe envelope. */
export function graphqlTransportErrorHandler(status: number, code: string, message = code) {
  return http.post(GRAPHQL_ENDPOINT, () => HttpResponse.json({ code, message }, { status }));
}

/** Simulated network failure for the GraphQL endpoint. */
export function graphqlNetworkErrorHandler() {
  return http.post(GRAPHQL_ENDPOINT, () => HttpResponse.error());
}
