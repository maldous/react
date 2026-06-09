/**
 * Pure merge helper for the broker-login global-setup (ADR-ACT-0157).
 *
 * Merges the E2E app origin's redirect URIs (and, when needed, web origins) into a
 * full Keycloak client representation WITHOUT dropping any existing field. The
 * caller GETs the full client, runs this, and PUTs the result back — so the PUT is
 * non-destructive and idempotent.
 */
export interface KeycloakClientRep {
  redirectUris?: string[];
  webOrigins?: string[];
  // The representation carries many other fields (id, clientId, secret config,
  // protocol mappers, …) — they must be preserved verbatim.
  [key: string]: unknown;
}

export interface MergeResult {
  merged: KeycloakClientRep;
  changed: boolean;
}

function union(existing: string[], add: string[]): { merged: string[]; added: number } {
  const set = new Set(existing);
  let added = 0;
  for (const v of add) {
    if (!set.has(v)) {
      set.add(v);
      added += 1;
    }
  }
  return { merged: [...set], added };
}

/**
 * Merge `redirectUris` (and optionally `webOrigins`) into `client`.
 *
 * - All existing redirectUris/webOrigins and every other client field are preserved.
 * - A webOrigins value of "+" means "derive allowed origins from redirectUris", so
 *   explicit origins are NOT added when "+" is present (already covered).
 * - `changed` is false when nothing new was added → the caller can skip the PUT,
 *   making reruns idempotent.
 */
export function mergeClientRedirects(
  client: KeycloakClientRep,
  redirectUris: string[],
  webOrigins: string[] = []
): MergeResult {
  const redirects = union(client.redirectUris ?? [], redirectUris);

  const currentOrigins = client.webOrigins ?? [];
  const originsCoveredByWildcard = currentOrigins.includes("+");
  const origins = originsCoveredByWildcard
    ? { merged: currentOrigins, added: 0 }
    : union(currentOrigins, webOrigins);

  const changed = redirects.added > 0 || origins.added > 0;

  return {
    merged: { ...client, redirectUris: redirects.merged, webOrigins: origins.merged },
    changed,
  };
}
