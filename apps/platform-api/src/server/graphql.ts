import { createLogger } from "@platform/platform-logging";
import { loadStageConfig } from "../config/stage-config.ts";
import {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  toSafeResponse,
} from "@platform/platform-errors";
import { createPlatformGraphQLSchema } from "@platform/adapters-graphql";
import {
  executeOperation,
  extractOperationFields,
  type ResolverMap,
} from "@platform/graphql-api-runtime";
import type { OrganisationProfile } from "@platform/contracts-organisation";
import { getOrganisationProfile, updateOrganisationDisplayName } from "../usecases/organisation.ts";
import {
  createOrganisationDependencies,
  getAuditEventPort,
  getApplicationPool,
  getSessionStore,
} from "./dependencies.ts";
import { getFixtureSession } from "./session.ts";
import { resolveTenantFromRequest } from "./tenant-resolver.ts";
import { parseSessionCookies } from "./auth.ts";
import {
  authorizeResourceAccess,
  type ResourceGuard,
  type AuthzOutcome,
} from "./authorize-resource.ts";
import type { PipelineHandler } from "./pipeline.ts";
import { serverT } from "./i18n.ts";
import { loadTenantResourcePolicies } from "./resource-policies.ts";
import { AuditAction, createAuditEvent } from "@platform/audit-events";

const gqlLog = createLogger({ name: "graphql", service: "platform-api", boundedContext: "bff" });

// ---------------------------------------------------------------------------
// GraphQL boundary (ADR-0013, ADR-ACT-0199)
//
// A single hardened POST /api/graphql endpoint. Authentication and tenant-FQDN
// enforcement are handled by the pipeline (route declares requiresAuth: true);
// per-operation authorisation is enforced here because one path serves multiple
// operations each with their own resource+scope.
//
// Hardening:
//   - operation allowlist: only the known fields execute (unknown → 400)
//   - introspection (__schema/__type) disabled unless PLATFORM_ENV=development
// ---------------------------------------------------------------------------

interface GraphQLContext {
  organisationId: string;
  actorId: string;
  actorRoles: string[];
  sourceHost?: string;
}

const resolvers: ResolverMap = {
  Query: {
    health: () => ({ status: "ok" }),
    organisationProfile: (
      _parent: unknown,
      _args: unknown,
      ctx: unknown
    ): Promise<OrganisationProfile> =>
      getOrganisationProfile(
        { organisationId: (ctx as GraphQLContext).organisationId },
        createOrganisationDependencies()
      ),
  },
  Mutation: {
    updateOrganisationProfile: (
      _parent: unknown,
      args: unknown,
      ctx: unknown
    ): Promise<OrganisationProfile> =>
      updateOrganisationDisplayName(
        {
          organisationId: (ctx as GraphQLContext).organisationId,
          displayName: (args as { displayName: string }).displayName,
          actor: {
            actorId: (ctx as GraphQLContext).actorId,
            actorRoles: (ctx as GraphQLContext).actorRoles,
            sourceHost: (ctx as GraphQLContext).sourceHost,
          },
        },
        createOrganisationDependencies()
      ),
  },
};

// Schema is built once at module load — resolvers are stateless and read the
// per-request organisation id from the GraphQL context.
const schema = createPlatformGraphQLSchema(resolvers);

// Per-field UMA guards. Fields absent from this map (e.g. health) need no authz.
const FIELD_GUARDS: Record<string, ResourceGuard> = {
  organisationProfile: {
    resource: "organisation:profile",
    umaScope: "read",
    requiredPermission: "organisation.read",
  },
  updateOrganisationProfile: {
    resource: "organisation:profile",
    umaScope: "write",
    requiredPermission: "organisation.update",
  },
};

const ALLOWED_FIELDS = new Set([...Object.keys(FIELD_GUARDS), "health"]);
const INTROSPECTION_FIELDS = new Set(["__schema", "__type"]);

function denyResponse(outcome: Exclude<AuthzOutcome, { ok: true }>): {
  status: number;
  body: unknown;
} {
  if (outcome.code === "stepUpRequired") {
    return {
      status: 401,
      body: { code: "STEP_UP_REQUIRED", message: "Additional authentication required" },
    };
  }
  const err =
    outcome.code === "authenticationRequired"
      ? new UnauthorizedError("api.error.authenticationRequired")
      : new ForbiddenError("api.error.permissionRequired", {
          safeDetails: { permission: outcome.permission },
        });
  return {
    status: outcome.status,
    body: toSafeResponse(err, (m) => serverT(m, { permission: outcome.permission })),
  };
}

/** A parsed, hardened GraphQL request, or a denial response to send. */
type GraphqlRequest =
  | {
      ok: true;
      query: string;
      operationName: string | undefined;
      variables: Record<string, unknown> | undefined;
      fields: string[];
    }
  | { ok: false; status: number; body: unknown };

/**
 * Parse + harden the GraphQL request body: query presence, document parse,
 * introspection gate, and the operation allowlist. No I/O — pure of the request body.
 */
function parseGraphqlRequest(rawBody: unknown): GraphqlRequest {
  const body = rawBody as
    | { query?: unknown; variables?: unknown; operationName?: unknown }
    | undefined;
  if (!body || typeof body.query !== "string" || body.query.trim().length === 0) {
    return {
      ok: false,
      status: 400,
      body: toSafeResponse(new ValidationError("api.error.graphqlQueryRequired"), (m) =>
        serverT(m)
      ),
    };
  }
  const operationName = typeof body.operationName === "string" ? body.operationName : undefined;
  const variables =
    body.variables && typeof body.variables === "object"
      ? (body.variables as Record<string, unknown>)
      : undefined;

  // Determine which top-level fields the operation touches.
  let fields: string[];
  try {
    fields = extractOperationFields(body.query, operationName);
  } catch {
    return {
      ok: false,
      status: 400,
      body: toSafeResponse(new ValidationError("api.error.graphqlInvalidDocument"), (m) =>
        serverT(m)
      ),
    };
  }

  // Hardening — introspection off outside development.
  const introspectionAllowed = (loadStageConfig().platformEnv ?? "") === "development";
  if (!introspectionAllowed && fields.some((f) => INTROSPECTION_FIELDS.has(f))) {
    return {
      ok: false,
      status: 400,
      body: toSafeResponse(new ValidationError("api.error.graphqlIntrospectionDisabled"), (m) =>
        serverT(m)
      ),
    };
  }

  // Hardening — operation allowlist (ignore __typename, always benign).
  const unknown = fields.filter((f) => f !== "__typename" && !ALLOWED_FIELDS.has(f));
  if (unknown.length > 0) {
    return {
      ok: false,
      status: 400,
      body: toSafeResponse(new ValidationError("api.error.graphqlUnknownOperation"), (m) =>
        serverT(m)
      ),
    };
  }

  return { ok: true, query: body.query, operationName, variables, fields };
}

/**
 * Resolve the session id from the FIRST presented platform_session cookie that
 * exists in the store, so a stale cookie can't break UMA token resolution
 * (ADR-ACT-0278). Returns null for fixture sessions or on store failure.
 */
async function resolveGraphqlSessionId(
  req: Parameters<PipelineHandler>[0]
): Promise<string | null> {
  if (getFixtureSession()) return null;
  try {
    const store = getSessionStore();
    for (const id of parseSessionCookies(req.raw.headers["cookie"])) {
      if (await store.find(id)) {
        return id;
      }
    }
  } catch (err) {
    gqlLog.error({ err }, "graphql: session store unavailable during resolution");
    return null;
  }
  return null;
}

export const handleGraphql: PipelineHandler = async (req, res) => {
  const actor = req.actor;
  if (!actor) {
    // requiresAuth on the route guarantees this, but keep the guard explicit.
    res.json(
      401,
      toSafeResponse(new UnauthorizedError("api.error.authenticationRequired"), (m) => serverT(m))
    );
    return;
  }

  const parsed = parseGraphqlRequest(req.body);
  if (!parsed.ok) {
    res.json(parsed.status, parsed.body);
    return;
  }
  const { query, operationName, variables, fields } = parsed;

  // Per-operation UMA authorisation — mirrors the REST route gate.
  const sessionId = await resolveGraphqlSessionId(req);
  const fqdnTenant = getFixtureSession()
    ? null
    : await resolveTenantFromRequest(req.raw, getApplicationPool()).catch(() => null);
  const resourcePolicies = await loadTenantResourcePolicies(fqdnTenant);

  for (const field of fields) {
    const guard = FIELD_GUARDS[field];
    if (!guard) continue;
    const outcome = await authorizeResourceAccess({
      actor,
      sessionId,
      fqdnTenant,
      guard,
      deps: { resourcePolicies },
    });
    if (!outcome.ok) {
      const { status, body: errBody } = denyResponse(outcome);
      res.json(status, errBody);
      return;
    }
  }

  await getAuditEventPort().emit(
    createAuditEvent({
      actorId: actor.userId,
      actorRoles: actor.roles,
      tenantId: actor.organisationId,
      action: AuditAction.GraphqlOperationExecuted,
      resource: "graphql",
      resourceId: operationName ?? fields.join(","),
      metadata: {
        operationName: operationName ?? null,
        fields,
        before: "not_executed",
        after: "execution_requested",
      },
      correlationId: req.requestId,
      sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
      ipAddress: req.raw.socket.remoteAddress,
    })
  );

  // Execute. Use-case errors (NotFound/Validation) surface as GraphQL errors;
  // translate i18n keys so the response does not leak raw message keys.
  const context: GraphQLContext = {
    organisationId: actor.organisationId,
    actorId: actor.userId,
    actorRoles: actor.roles,
    sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
  };
  const result = await executeOperation(schema, {
    query,
    operationName,
    variables,
    context,
  });
  if (result.errors?.length) {
    result.errors = result.errors.map((e: { message: string }) => ({
      message: serverT(e.message),
    }));
  }
  res.json(200, result);
};
