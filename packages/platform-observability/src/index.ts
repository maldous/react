import {
  trace,
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  type Span,
  type SpanAttributes,
  type Context,
} from "@opentelemetry/api";

export const packageName = "@platform/platform-observability";

export type OtelSpanAttributes = SpanAttributes;

export type SpanCallback<T> = (span: Span) => T | Promise<T>;

export function createTracer(name: string, version?: string): Tracer {
  return trace.getTracer(name, version);
}

export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  fn: SpanCallback<T>,
  attributes?: OtelSpanAttributes
): Promise<T> {
  const span = tracer.startSpan(name, { attributes });
  try {
    const result = await fn(span);
    span.end();
    return result;
  } catch (err) {
    recordException(span, err);
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
    throw err;
  }
}

export function withSpanSync<T>(
  tracer: Tracer,
  name: string,
  fn: SpanCallback<T>,
  attributes?: OtelSpanAttributes
): T {
  const span = tracer.startSpan(name, { attributes });
  try {
    const result = fn(span) as T;
    span.end();
    return result;
  } catch (err) {
    recordException(span, err);
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
    throw err;
  }
}

/**
 * Run `fn` inside an ACTIVE server-kind span, continuing any inbound W3C trace
 * context from `carrier` (incoming HTTP headers). Activating the span is what
 * makes downstream auto-instrumented work (pg, redis, outbound http) attach as
 * children and what lets getTraceContext()/Sentry read the trace id — necessary
 * because node:http is ESM-imported here and so is NOT patched by the SDK's
 * require-in-the-middle (ADR-ACT-0284). The span is the trace root when there is
 * no inbound parent.
 */
export async function withServerSpan<T>(
  name: string,
  carrier: Record<string, string | string[] | undefined>,
  attributes: OtelSpanAttributes,
  fn: SpanCallback<T>,
  tracerName = "platform-api"
): Promise<T> {
  const tracer = trace.getTracer(tracerName);
  const parent = propagation.extract(context.active(), carrier);
  return tracer.startActiveSpan(
    name,
    { kind: SpanKind.SERVER, attributes },
    parent,
    async (span) => {
      try {
        const result = await fn(span);
        span.end();
        return result;
      } catch (err) {
        recordException(span, err);
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        throw err;
      }
    }
  );
}

export function getTraceContext(): { traceId: string | undefined; spanId: string | undefined } {
  const activeContext: Context = context.active();
  const activeSpan = trace.getSpan(activeContext);
  if (activeSpan === undefined) {
    return { traceId: undefined, spanId: undefined };
  }
  const spanContext = activeSpan.spanContext();
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  };
}

export function recordException(span: Span, err: unknown): void {
  if (err instanceof Error) {
    span.recordException(err);
  } else {
    span.recordException(String(err));
  }
}

export function setSpanAttributes(span: Span, attrs: OtelSpanAttributes): void {
  span.setAttributes(attrs);
}
