import { createRoute, Link } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";
import { useSession } from "../hooks/use-session";
import { useTranslation } from "@platform/i18n-runtime";
import { LoadingState, Card, CardBody, Badge, SectionHeader } from "@platform/ui-design-system";
import { AppShell } from "../components/AppShell";
import { DEFAULT_LOG_SEARCH_PARAMS } from "../features/admin-logs/admin-logs.schema";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: IndexPage,
});

// External admin-tool clickthroughs (source of truth: docker/caddy/Caddyfile).
// Data-driven: hrefs are environment routing; labels/descriptions are i18n keys
// (landing.tool.<id>.*). WireMock is intentionally not exposed as a clickthrough.
interface ToolLink {
  id: string;
  href: string;
  profile?: string;
  testId: string;
}

const TOOL_LINKS: ToolLink[] = [
  { id: "keycloak", href: "/kc/", profile: "identity", testId: "tool-link-keycloak" },
  { id: "mailpit", href: "/mailpit/", testId: "tool-link-mailpit" },
  { id: "minio", href: "/minio/", testId: "tool-link-minio" },
  { id: "sonarqube", href: "/sonar/", profile: "quality", testId: "tool-link-sonarqube" },
  { id: "sentry", href: "/sentry/", profile: "external-sentry", testId: "tool-link-sentry" },
  { id: "grafana", href: "/grafana/", profile: "observability", testId: "tool-link-grafana" },
  { id: "clickhouse", href: "/clickhouse/play", testId: "tool-link-clickhouse" },
  { id: "pgadmin", href: "/pgadmin/", testId: "tool-link-pgadmin" },
];

const STATUS_LINKS: { id: string; href: string }[] = [
  { id: "health", href: "/healthz" },
  { id: "readiness", href: "/readyz" },
  { id: "version", href: "/version" },
  { id: "session", href: "/api/session" },
];

function IndexPage() {
  const { actor, isLoading, hasPermission } = useSession();
  const t = useTranslation();

  if (isLoading) {
    return <LoadingState message={t("auth.status.checkingAuthentication")} />;
  }

  // Unauthenticated entry screen (pre-shell): sign-in prompt.
  if (!actor) {
    return (
      <main
        id="main-content"
        className="app-safe-x flex min-h-screen flex-col items-center justify-center bg-gray-50 p-8"
        data-testid="sign-in-entry"
      >
        <div className="w-full max-w-sm space-y-6 text-center">
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl text-primary-foreground shadow-md"
            aria-hidden="true"
          >
            ⬡
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              {t("platform.name")}
            </h1>
            <p className="mt-1 text-sm text-gray-600">{t("platform.tagline")}</p>
          </div>
          <a
            href="/login"
            className="inline-flex items-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            data-testid="sign-in-link"
          >
            {t("auth.login.signInButton")}
          </a>
        </div>
      </main>
    );
  }

  const canReadLogs = hasPermission("platform.logs.read");

  return (
    <AppShell>
      <SectionHeader heading={t("landing.title")} level={1} className="mb-6" />

      {/* Internal platform admin features (SPA routes) */}
      {canReadLogs && (
        <section aria-labelledby="admin-heading" className="mb-8">
          <SectionHeader heading={t("landing.adminTools")} className="mb-4" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              to="/admin/logs"
              search={DEFAULT_LOG_SEARCH_PARAMS}
              className="group block no-underline"
              data-testid="admin-link-logs"
            >
              <Card className="h-full transition hover:border-indigo-300 hover:shadow">
                <CardBody>
                  <span className="font-medium text-gray-900 group-hover:text-indigo-600">
                    {t("landing.tool.logSearch.label")}
                  </span>
                  <span className="mt-0.5 block text-sm text-gray-600">
                    {t("landing.tool.logSearch.description")}
                  </span>
                </CardBody>
              </Card>
            </Link>
          </div>
        </section>
      )}

      {/* Service status endpoints */}
      <section aria-labelledby="status-heading" className="mb-8">
        <SectionHeader heading={t("landing.status")} className="mb-3" />
        <div className="flex flex-wrap gap-2">
          {STATUS_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm hover:bg-gray-50"
              target="_blank"
              rel="noreferrer"
            >
              {t(`landing.statusLink.${link.id}`)}
            </a>
          ))}
        </div>
      </section>

      {/* External admin tool clickthroughs */}
      <section aria-labelledby="tools-heading">
        <SectionHeader heading={t("landing.tools")} className="mb-4" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TOOL_LINKS.map((tool) => (
            <a
              key={tool.href}
              href={tool.href}
              className="group block no-underline"
              data-testid={tool.testId}
            >
              <Card className="h-full transition hover:border-indigo-300 hover:shadow">
                <CardBody>
                  <span className="font-medium text-gray-900 group-hover:text-indigo-600">
                    {t(`landing.tool.${tool.id}.label`)}
                  </span>
                  <span className="mt-0.5 block text-sm text-gray-600">
                    {t(`landing.tool.${tool.id}.description`)}
                  </span>
                  {tool.profile && (
                    <Badge variant="outline" className="mt-2">
                      {t("landing.profileGated", { profile: tool.profile })}
                    </Badge>
                  )}
                </CardBody>
              </Card>
            </a>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
