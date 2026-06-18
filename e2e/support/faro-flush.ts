// e2e/support/faro-flush.ts
//
// Owns ALL Faro / OpenTelemetry SDK-internal access used by the E2E trace proof
// (ADR-ACT-0285 browser↔BFF correlation). No spec should reach into
// ProxyTracerProvider internals directly; they go through this single helper.
//
// Why this exists: Faro's TracingInstrumentation batches browser spans in an
// OTEL BatchSpanProcessor (~5s scheduled delay). A Playwright page closes well
// before that, so without an explicit flush the browser (`react-enterprise-app`)
// span never POSTs to /faro/collect and the Tempo trace would contain only the
// `platform-api` server span. This helper force-flushes the real WebTracerProvider
// (the ProxyTracerProvider's delegate) so the span exports DETERMINISTICALLY,
// then allows a small bounded settle for the Faro transport's HTTP POST.
//
// Production behaviour is untouched: this is test-only code in e2e/, and it
// no-ops cleanly when Faro/the provider is absent (returning providerFound:false)
// rather than throwing — the caller decides whether that is a failure.
import type { Page } from "@playwright/test";

export interface FaroFlushResult {
  /** True when a Faro OTEL tracer provider with a forceFlush delegate was found. */
  providerFound: boolean;
  /** True when forceFlush() was invoked successfully. */
  flushed: boolean;
}

/** Bounded settle (ms) for the Faro transport to POST the flushed span batch. */
const TRANSPORT_SETTLE_MS = 1500;

/**
 * Flush the browser's batched OTEL spans through Faro so they reach the collector
 * before the page closes. Returns a structured result; never throws on a missing
 * provider. SDK-internal shapes (getOTEL / ProxyTracerProvider.getDelegate /
 * forceFlush) are confined to this function.
 */
export async function flushFaroTraces(page: Page): Promise<FaroFlushResult> {
  const result = await page.evaluate(async () => {
    const provider = (
      window as unknown as {
        faro?: { api?: { getOTEL?: () => { trace?: { getTracerProvider?: () => unknown } } } };
      }
    ).faro?.api
      ?.getOTEL?.()
      ?.trace?.getTracerProvider?.() as
      | {
          getDelegate?: () => { forceFlush?: () => Promise<void> };
        }
      | undefined;
    const delegate = provider?.getDelegate?.();
    if (typeof delegate?.forceFlush !== "function") {
      return { providerFound: false, flushed: false };
    }
    await delegate.forceFlush();
    return { providerFound: true, flushed: true };
  });
  // The forceFlush above is the deterministic step; this short, bounded wait only
  // covers the transport's fire-and-forget POST to /faro/collect. It is NOT a
  // substitute for flushing.
  await page.waitForTimeout(TRANSPORT_SETTLE_MS);
  return result;
}
