import type { OidcFetchOutcome, OidcHttpFetcher } from "../usecases/oidc-discovery.ts";

// ---------------------------------------------------------------------------
// Bounded outbound fetch for OIDC discovery/JWKS (ADR-0046). Enforces a hard
// timeout (AbortController) and a response size cap by streaming, so a hostile
// or slow endpoint cannot hang the BFF or exhaust memory. Returns a classified
// OidcFetchOutcome — the use case never sees a raw error or an oversized body.
// ---------------------------------------------------------------------------

async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return text.length > maxBytes ? null : text;
  }
  const decoder = new TextDecoder();
  let total = 0;
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

export function createOidcHttpFetcher(): OidcHttpFetcher {
  return {
    async get(
      url: string,
      opts: { timeoutMs: number; maxBytes: number }
    ): Promise<OidcFetchOutcome> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
      let res: Response;
      try {
        res = await fetch(url, {
          method: "GET",
          redirect: "follow",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
      } catch {
        clearTimeout(timer);
        return { kind: "network_error" };
      }
      try {
        if (!res.ok) return { kind: "http_error", status: res.status };
        const text = await readCapped(res, opts.maxBytes);
        if (text === null) return { kind: "too_large" };
        try {
          return { kind: "ok", json: JSON.parse(text) };
        } catch {
          return { kind: "not_json" };
        }
      } catch {
        return { kind: "network_error" };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
