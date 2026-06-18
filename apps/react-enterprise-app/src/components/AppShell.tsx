import { type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Badge, Button } from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import { useSession } from "../hooks/use-session";
import { useTheme } from "../theme/ThemeProvider";

export interface AppShellProps {
  children: ReactNode;
}

/**
 * Reusable authenticated app shell (ADR-0019, ADR-ACT-0195, ADR-ACT-0203).
 *
 * Owns the shared chrome — brand, actor display, logout — the safe-area padding,
 * and the single `<main id="main-content">`. Rendered by the `_authenticated`
 * pathless layout route around the route Outlet, so feature pages render content
 * only and never re-implement page structure. Responsive + safe-area aware so the
 * same markup works in browser, PWA, and a future Capacitor webview. Brand colour
 * and logo come from the tenant theme (ADR-0029).
 */
export function AppShell({ children }: Readonly<AppShellProps>) {
  const t = useTranslation();
  const { actor } = useSession();
  const theme = useTheme();

  function handleLogout() {
    // Full-page navigation to the BFF RP-initiated logout — intentionally NOT
    // SPA routing: the browser must follow the redirect chain to Keycloak to
    // terminate the SSO session and clear its cookies.
    window.location.href = "/auth/logout?returnTo=/login";
  }

  return (
    <div className="app-safe-x min-h-screen bg-surface-muted">
      <header className="app-safe-top border-b border-border bg-surface shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="flex items-center gap-3 no-underline"
            data-testid="app-shell-home"
            aria-label={t("app.shell.home")}
          >
            {theme.logoUrl ? (
              <img
                src={theme.logoUrl}
                alt=""
                aria-hidden="true"
                className="h-8 w-8 rounded-lg object-contain"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-base text-primary-foreground"
              >
                ⬡
              </span>
            )}
            <span className="text-base font-semibold text-fg sm:text-lg">{t("platform.name")}</span>
          </Link>
          {actor && (
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-fg-muted sm:inline" data-testid="actor-display">
                {actor.displayName}
                {actor.roles[0] && <Badge className="ml-2">{actor.roles[0]}</Badge>}
              </span>
              <Button
                variant="outline"
                size="sm"
                onPress={handleLogout}
                data-testid="logout-button"
              >
                {t("auth.logout.label")}
              </Button>
            </div>
          )}
        </div>
      </header>

      <main
        id="main-content"
        className="app-safe-bottom mx-auto max-w-7xl px-4 py-6 sm:px-6"
        data-testid="app-shell-main"
      >
        {children}
      </main>
    </div>
  );
}
