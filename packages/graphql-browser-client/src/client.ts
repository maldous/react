// Browser-safe GraphQL transport client (ADR-0013, ADR-0019, ADR-0022,
// ADR-ACT-0203).
//
// This is the ONLY place in the browser that turns a TypedDocumentNode into a
// query string. It imports `print` from the `graphql/language/printer` subpath
// — the AST printer only — never `graphql` execution, schema, or any server /
// platform-api package. The BFF still receives a normal `{ query, variables }`
// JSON body over POST /api/graphql.
//
// Feature code imports generated documents from @platform/contracts-graphql and
// passes them here; feature code never calls `print()` and never contains inline
// GraphQL operation strings (enforced by validate-frontend-graphql).
import { print } from "graphql/language/printer";
import type { TypedDocumentNode } from "@graphql-typed-document-node/core";

export const DEFAULT_GRAPHQL_ENDPOINT = "/api/graphql";

/**
 * The single client-side error type for GraphQL transport. Carries a stable
 * `code` and HTTP `status` (0 for network failures) so callers branch on those
 * rather than parsing messages. `message` is the server's already-translated
 * safe message where one is available.
 */
export class GraphQLClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, options: { code: string; status: number; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GraphQLClientError";
    this.code = options.code;
    this.status = options.status;
  }
}

export interface GraphQLClientConfig {
  /** Defaults to {@link DEFAULT_GRAPHQL_ENDPOINT}. */
  endpoint?: string;
  /** Override the fetch implementation (tests / SSR). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
}

export interface GraphQLClient {
  request<TData, TVariables>(
    document: TypedDocumentNode<TData, TVariables>,
    variables?: TVariables
  ): Promise<TData>;
}

interface RawGraphQLResponse<TData> {
  data?: TData | null;
  errors?: Array<{ message: string }>;
}

interface SafeErrorEnvelope {
  code?: string;
  message?: string;
}

export function createGraphQLClient(config: GraphQLClientConfig = {}): GraphQLClient {
  const endpoint = config.endpoint ?? DEFAULT_GRAPHQL_ENDPOINT;

  return {
    async request<TData, TVariables>(
      document: TypedDocumentNode<TData, TVariables>,
      variables?: TVariables
    ): Promise<TData> {
      // Resolve fetch at call time, not at client creation: capturing
      // globalThis.fetch eagerly would bypass test interceptors (MSW) that
      // replace the global after this module loads.
      const doFetch = config.fetchImpl ?? globalThis.fetch;
      const query = print(document);

      let res: Response;
      try {
        res = await doFetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...config.headers },
          credentials: "include",
          body: JSON.stringify({ query, variables: variables ?? undefined }),
        });
      } catch (cause) {
        throw new GraphQLClientError("Network request failed", {
          code: "NETWORK_ERROR",
          status: 0,
          cause,
        });
      }

      // Transport-level failures (auth, validation) arrive as non-2xx with the
      // platform safe error envelope { code, message }.
      if (!res.ok) {
        const envelope = (await res.json().catch(() => ({}))) as SafeErrorEnvelope;
        throw new GraphQLClientError(envelope.message ?? envelope.code ?? "Request failed", {
          code: envelope.code ?? "UNKNOWN",
          status: res.status,
        });
      }

      const json = (await res.json().catch(() => ({}))) as RawGraphQLResponse<TData>;

      // GraphQL execution errors arrive 200 with an `errors` array; messages are
      // already translated server-side.
      if (json.errors && json.errors.length > 0) {
        throw new GraphQLClientError(json.errors[0]?.message ?? "GraphQL error", {
          code: "GRAPHQL_ERROR",
          status: res.status,
        });
      }

      if (json.data == null) {
        throw new GraphQLClientError("Malformed GraphQL response: missing data", {
          code: "MALFORMED_RESPONSE",
          status: res.status,
        });
      }

      return json.data;
    },
  };
}

/** Default browser GraphQL client bound to the BFF endpoint. */
export const graphqlClient: GraphQLClient = createGraphQLClient();

/**
 * Execute a generated operation through the default client. Feature hooks call
 * this with a generated TypedDocumentNode; TypeScript infers the result and
 * variable types from the document.
 */
export function graphqlRequest<TData, TVariables>(
  document: TypedDocumentNode<TData, TVariables>,
  variables?: TVariables
): Promise<TData> {
  return graphqlClient.request(document, variables);
}
