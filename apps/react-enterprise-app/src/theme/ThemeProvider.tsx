import { createContext, useContext, useEffect, type ReactNode } from "react";
import { applyThemeToDocument, DEFAULT_THEME, type Theme } from "./theme";
import { useThemeQuery } from "./use-theme";

// Context default is the safe default theme, so useTheme() works outside a
// provider (e.g. component tests) — mirroring the i18n default-instance pattern.
const ThemeContext = createContext<Theme>(DEFAULT_THEME);

/**
 * Applies tenant branding (ADR-0029) at the application root, above the router,
 * so login, the unauthenticated entry, and the AppShell all receive it. The
 * brand colour is written to the document as a CSS variable; until the fetch
 * resolves, the built-in @theme defaults render — no flash of broken UI. Theme
 * values are validated before reaching the DOM (no unsafe CSS injection).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { data: theme } = useThemeQuery();
  const resolved = theme ?? DEFAULT_THEME;

  useEffect(() => {
    applyThemeToDocument(resolved);
  }, [resolved]);

  return <ThemeContext.Provider value={resolved}>{children}</ThemeContext.Provider>;
}

/** Read the active (validated) tenant theme — displayName, logo, brand colour. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}
