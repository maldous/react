import { useQuery } from "@tanstack/react-query";
import { DEFAULT_THEME, parseTheme, type Theme } from "./theme";

export const themeQueryKey = ["theme"] as const;

/**
 * Fetch and validate the tenant theme from the BFF. Always resolves to a usable
 * Theme: a non-OK response or malformed payload falls back to DEFAULT_THEME, so
 * branding never blocks render and there is no broken-UI flash.
 */
async function fetchTheme(): Promise<Theme> {
  const res = await fetch("/api/theme", { credentials: "include" });
  if (!res.ok) return DEFAULT_THEME;
  return parseTheme(await res.json().catch(() => null));
}

export function useThemeQuery() {
  return useQuery({
    queryKey: themeQueryKey,
    queryFn: fetchTheme,
    // Theme rarely changes within a session; keep it stable and cached.
    staleTime: 5 * 60_000,
    retry: false,
    // Render immediately with the default; swap in tenant branding on resolve.
    placeholderData: DEFAULT_THEME,
  });
}
