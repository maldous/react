import { createRoute, useNavigate } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";
import { useSession, sessionQueryKey } from "../hooks/use-session";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@platform/i18n-runtime";
import { LoadingState } from "@platform/ui-design-system";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: IndexPage,
});

// ---------------------------------------------------------------------------
// Tool link definitions — source of truth: docker/caddy/Caddyfile
// Routes are path-prefixed behind Caddy on aldous.info (ADR-0029 §1a).
// ---------------------------------------------------------------------------

interface ToolLink {
  label: string;
  href: string;
  description: string;
  /** Compose profile required; link is shown but may return 502 if not running */
  profileGated?: string;
}

const TOOL_LINKS: ToolLink[] = [
  {
    label: "Keycloak",
    href: "/kc",
    description: "Identity and SSO — all realms",
    profileGated: "identity",
  },
  { label: "Mailpit", href: "/mailpit", description: "Caught email (all tenants)" },
  { label: "MinIO", href: "/minio", description: "Object storage console" },
  {
    label: "SonarQube",
    href: "/sonar",
    description: "Code quality dashboard",
    profileGated: "quality",
  },
  {
    label: "Sentry",
    href: "/sentry",
    description: "Error and performance monitoring",
    profileGated: "sentry",
  },
  {
    label: "WireMock",
    href: "/wiremock",
    description: "External HTTP mock admin",
    profileGated: "external-mocks",
  },
  { label: "ClickHouse", href: "/clickhouse", description: "Analytics HTTP play UI" },
];

const STATUS_LINKS: { label: string; href: string }[] = [
  { label: "Health", href: "/healthz" },
  { label: "Readiness", href: "/readyz" },
  { label: "Version", href: "/version" },
  { label: "Session", href: "/api/session" },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function IndexPage() {
  const { actor, isLoading } = useSession();
  const t = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function handleLogout() {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
    await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    void navigate({ to: "/auth/login" });
  }

  if (isLoading) {
    return <LoadingState message={t("auth.status.checkingAuthentication")} />;
  }

  // Unauthenticated: show sign-in prompt
  if (!actor) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-8">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-2xl text-white shadow-md"
            aria-hidden="true"
          >
            ⬡
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              {t("platform.name")}
            </h1>
            <p className="mt-1 text-sm text-gray-500">{t("platform.tagline")}</p>
          </div>
          <a
            href="/auth/login"
            className="inline-flex items-center rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
            data-testid="sign-in-link"
          >
            {t("auth.login.signInButton")}
          </a>
        </div>
      </div>
    );
  }

  // Authenticated: super-global admin landing page
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="border-b border-gray-200 bg-white px-6 py-4 shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-base text-white"
              aria-hidden="true"
            >
              ⬡
            </span>
            <h1 className="text-lg font-semibold text-gray-900">{t("platform.name")}</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600" data-testid="actor-display">
              {actor.displayName}
              {actor.roles.length > 0 && (
                <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
                  {actor.roles[0]}
                </span>
              )}
            </span>
            <button
              onClick={() => void handleLogout()}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              data-testid="logout-button"
            >
              {t("auth.logout.label")}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Status links */}
        <section aria-labelledby="status-heading" className="mb-8">
          <h2
            id="status-heading"
            className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400"
          >
            {t("landing.status")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {STATUS_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm hover:bg-gray-50"
                target="_blank"
                rel="noreferrer"
              >
                {link.label}
              </a>
            ))}
          </div>
        </section>

        {/* Admin tool links */}
        <section aria-labelledby="tools-heading">
          <h2
            id="tools-heading"
            className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-400"
          >
            {t("landing.tools")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TOOL_LINKS.map((tool) => (
              <a
                key={tool.href}
                href={tool.href}
                className="group flex flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-indigo-300 hover:shadow"
                data-testid={`tool-link-${tool.label.toLowerCase()}`}
              >
                <span className="font-medium text-gray-900 group-hover:text-indigo-600">
                  {tool.label}
                </span>
                <span className="mt-0.5 text-xs text-gray-500">{tool.description}</span>
                {tool.profileGated && (
                  <span className="mt-2 self-start rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700 ring-1 ring-amber-200">
                    profile: {tool.profileGated}
                  </span>
                )}
              </a>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
