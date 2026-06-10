import { createRoute, Link } from "@tanstack/react-router";
import { Card, CardBody, ForbiddenState } from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import { Route as AdminLayoutRoute } from "./layout";
import { useSession } from "../../hooks/use-session";
import { ADMIN_NAV_ITEMS, AdminSectionHeader } from "../../components/AdminLayout";

export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "/",
  component: AdminOverviewRoute,
});

function AdminOverviewRoute() {
  const t = useTranslation();
  const { hasPermission } = useSession();

  // Sections (everything but the overview entry) the user can actually reach.
  const sections = ADMIN_NAV_ITEMS.filter((i) => i.to !== "/admin" && hasPermission(i.permission));

  if (!hasPermission("tenant.admin.access") && sections.length === 0) {
    return (
      <ForbiddenState
        title={t("ui.accessDenied.title")}
        description={t("ui.accessDenied.description", { permission: "tenant.admin.access" })}
      />
    );
  }

  return (
    <section data-testid="admin-overview">
      <AdminSectionHeader
        heading={t("feature.admin.overview.title")}
        description={t("feature.admin.overview.description")}
      />
      {sections.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("feature.admin.overview.empty")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className="no-underline"
              data-testid={`admin-overview-card-${s.to.split("/").pop()}`}
            >
              <Card className="h-full transition-colors hover:border-primary">
                <CardBody>
                  <h2 className="text-base font-semibold text-fg">{t(s.labelKey)}</h2>
                  <p className="mt-1 text-sm text-fg-muted">
                    {t(`${s.labelKey.replace(".nav.", ".card.")}Description`)}
                  </p>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
