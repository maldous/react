import { createRoute } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";
import { useSession } from "../hooks/use-session";
import { useTranslation } from "@platform/i18n-runtime";
import { LoadingState, Card, CardBody, Badge, Button } from "@platform/ui-design-system";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: IndexPage,
});

// ---------------------------------------------------------------------------
// Tool link definitions — source of truth: docker/caddy/Caddyfile
// All routes are path-prefixed behind Caddy on aldous.info (ADR-0029 §1a).
// WireMock is NOT exposed as a clickthrough — access directly via port in dev.
// ---------------------------------------------------------------------------

interface ToolLink {
  label: string;
  href: string;
  description: string;
  /** Compose profile required; link is shown but may return 502 if not running */
  profileGated?: string;
  testId: string;
}

const TOOL_LINKS: ToolLink[] = [
  {
    label: "Keycloak",
    href: "/kc/",
    description: "Identity and SSO — all realms",
    profileGated: "identity",
    testId: "tool-link-keycloak",
  },
  {
    label: "Mailpit",
    href: "/mailpit/",
    description: "Caught email (all tenants)",
    testId: "tool-link-mailpit",
  },
  {
    label: "MinIO",
    href: "/minio/",
    description: "Object storage console",
    testId: "tool-link-minio",
  },
  {
    label: "SonarQube",
    href: "/sonar/",
    description: "Code quality dashboard",
    profileGated: "quality",
    testId: "tool-link-sonarqube",
  },
  {
    label: "Sentry",
    href: "/sentry/",
    description: "Error and performance monitoring",
    profileGated: "external-sentry",
    testId: "tool-link-sentry",
  },
  // WireMock intentionally absent — NOT_EXPOSED as a user-facing clickthrough.
  // Access WireMock directly at http://localhost:${WIREMOCK_PORT:-8089}/__admin/
  {
    label: "Grafana",
    href: "/grafana/",
    description: "Log search and dashboards (observability profile)",
    profileGated: "observability",
    testId: "tool-link-grafana",
  },
  {
    label: "ClickHouse",
    href: "/clickhouse/play",
    description: "Analytics HTTP play UI",
    testId: "tool-link-clickhouse",
  },
  {
    label: "pgAdmin",
    href: "/pgadmin/",
    description: "PostgreSQL database admin",
    testId: "tool-link-pgadmin",
  },
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

  function handleLogout() {
    // Full-page navigation to GET /auth/logout?returnTo=/login so the browser
    // follows the redirect chain to Keycloak RP-Initiated Logout, which
    // terminates the SSO session. Using fetch() cannot perform the browser-
    // level redirect that Keycloak needs to clear its own session cookies.
    window.location.href = "/auth/logout?returnTo=/login";
  }

  if (isLoading) {
    return <LoadingState message={t("auth.status.checkingAuthentication")} />;
  }

  // Unauthenticated: show sign-in prompt linking to the React login entry page
  if (!actor) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-8"
        data-testid="sign-in-entry"
      >
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
          {/* Link to the React-rendered login entry page (/login), not the BFF endpoint */}
          <a
            href="/login"
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
              {actor.roles.length > 0 && <Badge className="ml-2">{actor.roles[0]}</Badge>}
            </span>
            <Button
              variant="outline"
              size="sm"
              onPress={() => void handleLogout()}
              data-testid="logout-button"
            >
              {t("auth.logout.label")}
            </Button>
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
                className="group block no-underline"
                data-testid={tool.testId}
              >
                <Card className="h-full transition hover:border-indigo-300 hover:shadow">
                  <CardBody className="p-4">
                    <span className="font-medium text-gray-900 group-hover:text-indigo-600">
                      {tool.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-500">{tool.description}</span>
                    {tool.profileGated && (
                      <Badge className="mt-2 bg-amber-50 text-amber-700 ring-1 ring-amber-200">
                        profile: {tool.profileGated}
                      </Badge>
                    )}
                  </CardBody>
                </Card>
              </a>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
