import type {
  GetOrganisationProfileResponse,
  UpdateOrganisationProfileRequest,
  UpdateOrganisationProfileResponse,
} from "@platform/contracts-organisation";

// Application data flows through the GraphQL boundary (ADR-0013, ADR-ACT-0199).
// The SPA is browser-only and must not import graphql/adapters (ADR-0022), so it
// talks to the BFF /api/graphql endpoint with plain fetch and types responses
// from @platform/contracts-organisation. Operations are session-scoped: the BFF
// derives the organisation from the authenticated session (no id is sent).

const GRAPHQL_ENDPOINT = "/api/graphql";

const PROFILE_FIELDS = "id slug displayName createdAt updatedAt";

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: Array<{ message: string }>;
}

interface RequestError extends Error {
  code?: string;
  status?: number;
}

function makeError(message: string, code: string | undefined, status: number): RequestError {
  return Object.assign(new Error(message), { code, status });
}

async function graphqlRequest<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ query, variables }),
  });

  // Transport-level failures (auth, validation) come back as non-2xx with the
  // platform's safe error envelope { code, message }.
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ code: "UNKNOWN" }))) as {
      message?: string;
      code?: string;
    };
    throw makeError(err.message ?? err.code ?? "UNKNOWN", err.code, res.status);
  }

  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors && json.errors.length > 0) {
    const message = json.errors[0]?.message ?? "UNKNOWN";
    throw makeError(message, message, 400);
  }
  if (json.data == null) {
    throw makeError("UNKNOWN", "UNKNOWN", 502);
  }
  return json.data;
}

export async function fetchOrganisationProfile(): Promise<GetOrganisationProfileResponse> {
  const data = await graphqlRequest<{ organisationProfile: GetOrganisationProfileResponse }>(
    `query OrganisationProfile { organisationProfile { ${PROFILE_FIELDS} } }`
  );
  return data.organisationProfile;
}

export async function updateOrganisationProfile(
  input: UpdateOrganisationProfileRequest
): Promise<UpdateOrganisationProfileResponse> {
  const data = await graphqlRequest<{
    updateOrganisationProfile: UpdateOrganisationProfileResponse;
  }>(
    `mutation UpdateOrganisationProfile($displayName: String!) {
      updateOrganisationProfile(displayName: $displayName) { ${PROFILE_FIELDS} }
    }`,
    { displayName: input.displayName }
  );
  return data.updateOrganisationProfile;
}
