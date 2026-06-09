import { useQuery } from "@tanstack/react-query";

/**
 * Login provider list contract (ADR-ACT-0157). Mirrors the BFF
 * GET /api/auth/providers response. The SPA only ever renders these and links to
 * `loginUrl` (the BFF handoff) — it never talks to Keycloak or the upstream
 * provider directly, and the payload carries no secrets.
 */
export interface LoginProvider {
  id: string;
  label: string;
  type: "oidc" | "keycloak";
  loginUrl: string;
  enabled: boolean;
  mode: "mock" | "real" | "internal";
}

export const loginProvidersQueryKey = ["auth", "providers"] as const;

/** Product ids with a dedicated i18n label; others fall back to the server label. */
const KNOWN_IDS = new Set(["platform", "google", "azure", "apple"]);
export function providerLabelKey(id: string): string | null {
  return KNOWN_IDS.has(id) ? `auth.login.providers.${id}` : null;
}

/**
 * Defence in depth: only render providers whose loginUrl is the relative BFF
 * handoff. This guarantees a button can never deep-link to Keycloak or the
 * mock-oidc fixture even if the API response were tampered with.
 */
function isSafeLoginUrl(url: unknown): url is string {
  return typeof url === "string" && /^\/auth\/login(\?|$)/.test(url);
}

async function fetchLoginProviders(): Promise<LoginProvider[]> {
  const res = await fetch("/api/auth/providers", { credentials: "include" });
  if (!res.ok) throw new Error(`provider list failed: ${res.status}`);
  const data: unknown = await res.json();
  if (!Array.isArray(data)) return [];
  return (data as LoginProvider[]).filter((p) => p.enabled !== false && isSafeLoginUrl(p.loginUrl));
}

export function useLoginProviders() {
  return useQuery({
    queryKey: loginProvidersQueryKey,
    queryFn: fetchLoginProviders,
    retry: false,
    staleTime: 60_000,
  });
}
