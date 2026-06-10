import { createRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "./__root";
import { useTranslation } from "@platform/i18n-runtime";
import {
  Card,
  CardBody,
  Badge,
  LoadingState,
  EmptyState,
  ErrorState,
} from "@platform/ui-design-system";
import {
  useLoginProviders,
  providerLabelKey,
  providerHelpKey,
  type LoginProvider,
} from "../auth/login-providers.ts";

/**
 * Application login selector — /login (ADR-ACT-0155, ADR-ACT-0157).
 *
 * Renders the brokered login options from the BFF (GET /api/auth/providers) and
 * links each to the BFF handoff (/auth/login?provider=<id>) via a full-page <a>,
 * which Caddy proxies to platform-api. The SPA never links to Keycloak or the
 * upstream/mock identity provider directly — Keycloak is always the broker.
 */
export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/login",
  component: LoginPage,
});

/** Simple, brand-neutral glyph placeholder per provider (no brand colours). */
function providerGlyph(id: string): string {
  switch (id) {
    case "platform":
      return "⬡";
    case "google":
      return "G";
    case "azure":
      return "M"; // Microsoft
    case "apple":
      return "A";
    default:
      return (id[0] ?? "?").toUpperCase();
  }
}

function ProviderRow({ provider }: { provider: LoginProvider }) {
  const t = useTranslation();
  const labelKey = providerLabelKey(provider.id);
  const helpKey = providerHelpKey(provider.id);
  const label = labelKey ? t(labelKey) : provider.label;
  const help = helpKey ? t(helpKey) : "";
  const isPlatform = provider.type === "keycloak";
  const isMock = provider.mode === "mock";
  // The platform option keeps the legacy testid so existing E2E helpers (which
  // click "sign-in-button" to drive the platform login) continue to work.
  const testId = isPlatform ? "sign-in-button" : `login-provider-${provider.id}`;

  return (
    <a
      href={provider.loginUrl}
      data-testid={testId}
      data-provider={provider.id}
      className={[
        "group flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        isPlatform
          ? "border-primary/30 bg-primary/5 hover:bg-primary/10"
          : "border-border bg-surface hover:bg-surface-muted",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
          isPlatform ? "bg-primary text-primary-foreground" : "bg-surface-muted text-fg",
        ].join(" ")}
      >
        {providerGlyph(provider.id)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-fg">{label}</span>
          {isMock && (
            <Badge variant="secondary" data-testid={`login-provider-mock-${provider.id}`}>
              {t("auth.login.mockBadge")}
            </Badge>
          )}
        </span>
        {help && <span className="mt-0.5 block text-xs text-fg-muted">{help}</span>}
      </span>

      <span
        aria-hidden="true"
        className="text-fg-muted transition-transform group-hover:translate-x-0.5"
      >
        ›
      </span>
    </a>
  );
}

/** Map a BFF `?authError=` code (set when a brokered login is refused at the callback)
 * to a friendly i18n key. Unknown codes fall back to a generic message. */
function authErrorKey(): string | null {
  if (typeof window === "undefined") return null;
  const code = new URLSearchParams(window.location.search).get("authError");
  if (!code) return null;
  const known = ["email_unverified", "account_conflict"];
  return `auth.login.rejected.${known.includes(code) ? code : "generic"}`;
}

export function LoginPage() {
  const t = useTranslation();
  const { data: providers, isLoading, isError } = useLoginProviders();
  const rejectedKey = authErrorKey();

  return (
    <main
      id="main-content"
      className="app-safe-x flex min-h-screen flex-col items-center justify-center bg-surface-muted p-8"
    >
      <div className="w-full max-w-sm space-y-8">
        {/* Platform branding */}
        <div className="text-center">
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl text-primary-foreground shadow-md"
            aria-hidden="true"
          >
            ⬡
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-fg">{t("platform.name")}</h1>
          <p className="mt-1 text-sm text-fg-muted">{t("platform.tagline")}</p>
        </div>

        {/* Sign-in card */}
        <Card>
          <CardBody className="space-y-5 p-8">
            <div>
              <h2 className="text-base font-semibold text-fg">{t("auth.login.title")}</h2>
              <p className="mt-1 text-sm text-fg-muted">{t("auth.login.chooseProvider")}</p>
            </div>

            {rejectedKey && (
              <div
                role="alert"
                data-testid="login-auth-error"
                className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
              >
                {t(rejectedKey)}
              </div>
            )}

            {isLoading && (
              <div data-testid="login-loading">
                <LoadingState message={t("auth.login.loading")} className="py-8" />
              </div>
            )}

            {isError && (
              <div data-testid="login-error">
                <ErrorState title={t("auth.login.error")} className="py-8" />
              </div>
            )}

            {!isLoading && !isError && providers && providers.length === 0 && (
              <div data-testid="login-empty">
                <EmptyState title={t("auth.login.empty")} className="py-8" />
              </div>
            )}

            {!isLoading && !isError && providers && providers.length > 0 && (
              <div data-testid="login-providers" className="space-y-3">
                {providers.map((p) => (
                  <ProviderRow key={p.id} provider={p} />
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <p className="text-center text-xs text-fg-muted">{t("auth.login.footer")}</p>
      </div>
    </main>
  );
}
