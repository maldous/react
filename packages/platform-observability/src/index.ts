import {
  trace,
  context,
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
