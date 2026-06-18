export const packageName = "@platform/platform-runtime-context";

export interface RuntimeContext {
  requestId: string;
  traceId?: string;
  spanId?: string;
  actorId?: string;
  tenantId?: string;
  organisationId?: string;
  correlationId?: string;
  featureName?: string;
  operationName?: string;
}

export function createContext(fields: RuntimeContext): RuntimeContext {
  return { ...fields };
}

export function createRequestContext(
  requestId: string,
  overrides?: Partial<Omit<RuntimeContext, "requestId">>
): RuntimeContext {
  return { requestId, ...overrides };
}

export function withOperation(ctx: RuntimeContext, operationName: string): RuntimeContext {
  return { ...ctx, operationName };
}

export function withFeature(ctx: RuntimeContext, featureName: string): RuntimeContext {
  return { ...ctx, featureName };
}

export function withActor(ctx: RuntimeContext, actorId: string): RuntimeContext {
  return { ...ctx, actorId };
}

export function withTenant(
  ctx: RuntimeContext,
  tenantId: string,
  organisationId?: string
): RuntimeContext {
  return { ...ctx, tenantId, organisationId };
}

export function withTrace(ctx: RuntimeContext, traceId: string, spanId?: string): RuntimeContext {
  return { ...ctx, traceId, spanId };
}

/** Returns only the requestId field ? safe to expose to browser/React features. */
export function safeClientContext(ctx: RuntimeContext): Pick<RuntimeContext, "requestId"> {
  return { requestId: ctx.requestId };
}
