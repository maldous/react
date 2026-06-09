import { z } from "zod";

// Typed, bookmarkable admin-log search state (ADR-0019 §2: search params own
// durable filter state). Used for TanStack Router validateSearch AND the React
// Hook Form schema, so the URL, the form, and the BFF query stay in lock-step.

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export const LOG_RANGES = ["15m", "1h", "24h", "7d"] as const;
export const LOG_DIRECTIONS = ["backward", "forward"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogRange = (typeof LOG_RANGES)[number];
export type LogDirection = (typeof LOG_DIRECTIONS)[number];

const optionalText = z.string().trim().optional().catch(undefined);

export const LogSearchParamsSchema = z.object({
  service: optionalText,
  level: z.enum(LOG_LEVELS).optional().catch(undefined),
  requestId: optionalText,
  traceId: optionalText,
  tenantId: optionalText,
  actorId: optionalText,
  organisationId: optionalText,
  text: optionalText,
  range: z.enum(LOG_RANGES).default("1h").catch("1h"),
  limit: z.coerce.number().int().min(1).max(1000).default(200).catch(200),
  direction: z.enum(LOG_DIRECTIONS).default("backward").catch("backward"),
});

export type LogSearchParams = z.infer<typeof LogSearchParamsSchema>;

/** Lenient parse for validateSearch — never throws, applies defaults. */
export function parseLogSearchParams(input: unknown): LogSearchParams {
  return LogSearchParamsSchema.parse(input ?? {});
}

/** Default (unfiltered) search params — single source for links into the route. */
export const DEFAULT_LOG_SEARCH_PARAMS: LogSearchParams = LogSearchParamsSchema.parse({});

// React Hook Form value schema (controlled inputs use empty strings, not
// undefined; level allows "" for "any"). Real coercion to URL params happens in
// formValuesToParams via LogSearchParamsSchema.
export const LogSearchFormSchema = z.object({
  service: z.string(),
  level: z.union([z.enum(LOG_LEVELS), z.literal("")]),
  requestId: z.string(),
  traceId: z.string(),
  tenantId: z.string(),
  actorId: z.string(),
  organisationId: z.string(),
  text: z.string(),
  range: z.enum(LOG_RANGES),
});

export type LogSearchFormValues = z.infer<typeof LogSearchFormSchema>;

export function paramsToFormValues(params: LogSearchParams): LogSearchFormValues {
  return {
    service: params.service ?? "",
    level: params.level ?? "",
    requestId: params.requestId ?? "",
    traceId: params.traceId ?? "",
    tenantId: params.tenantId ?? "",
    actorId: params.actorId ?? "",
    organisationId: params.organisationId ?? "",
    text: params.text ?? "",
    range: params.range,
  };
}

/** Collapse empty form strings to undefined so they drop out of the URL. */
export function formValuesToParams(values: LogSearchFormValues): LogSearchParams {
  const clean = (s: string): string | undefined => (s.trim().length > 0 ? s.trim() : undefined);
  return LogSearchParamsSchema.parse({
    service: clean(values.service),
    level: values.level || undefined,
    requestId: clean(values.requestId),
    traceId: clean(values.traceId),
    tenantId: clean(values.tenantId),
    actorId: clean(values.actorId),
    organisationId: clean(values.organisationId),
    text: clean(values.text),
    range: values.range,
  });
}
