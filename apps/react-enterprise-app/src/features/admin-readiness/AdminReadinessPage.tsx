import { Link } from "@tanstack/react-router";
import { Card, CardBody, Badge, LoadingState, EmptyState } from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import {
  CAPABILITY_CATEGORIES,
  type CapabilityCategory,
  type CapabilityReadiness,
  type CapabilitySummary,
  type TenantReadinessStatus,
} from "@platform/contracts-admin";
import { AdminSectionHeader } from "../../components/AdminLayout";
import { AdminQueryError } from "../admin/AdminQueryError";
import { useTenantReadiness } from "./use-admin-readiness";

// Readiness/impl status → design-system Badge variant. Kept UX-only; the BFF is
// the source of truth for the status itself (ADR-0045).
const READINESS_VARIANT: Record<CapabilityReadiness, "default" | "secondary" | "destructive"> = {
  ready: "default",
  incomplete: "secondary",
  blocked: "destructive",
  degraded: "destructive",
  unknown: "secondary",
  deferred: "secondary",
};

const OVERALL_VARIANT: Record<TenantReadinessStatus, "default" | "secondary" | "destructive"> = {
  ready: "default",
  incomplete: "secondary",
  blocked: "destructive",
  degraded: "destructive",
  unknown: "secondary",
};

const ATTENTION: ReadonlySet<CapabilityReadiness> = new Set([
  "incomplete",
  "blocked",
  "degraded",
  "unknown",
]);

/**
 * Tenant readiness / setup surface (ADR-0045). Renders the enterprise
 * control-plane capability map grouped by category, with each capability's
 * readiness, implementation status, a link to the screen that manages it, and a
 * missing-action hint when it needs attention. The BFF computes readiness; this
 * view only renders it.
 */
export function AdminReadinessPage() {
  const t = useTranslation();
  const { data, isLoading, isError, error } = useTenantReadiness();

  return (
    <section data-testid="admin-readiness">
      <AdminSectionHeader
        heading={t("feature.admin.readiness.title")}
        description={t("feature.admin.readiness.description")}
      />

      {isLoading ? (
        <LoadingState message={t("auth.status.loading")} />
      ) : isError ? (
        <AdminQueryError error={error} />
      ) : !data ? (
        <EmptyState title={t("feature.admin.readiness.unavailable")} />
      ) : (
        <div className="space-y-6">
          <div data-testid="readiness-overall">
            <Card>
              <CardBody className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-fg">
                    {t("feature.admin.readiness.overall")}
                  </p>
                  <p className="text-sm text-fg-muted">
                    {t(`feature.admin.readiness.overallHint.${data.overall}` as const)}
                  </p>
                </div>
                <Badge variant={OVERALL_VARIANT[data.overall]}>
                  {t(`feature.admin.readiness.status.${data.overall}` as const)}
                </Badge>
              </CardBody>
            </Card>
          </div>

          {CAPABILITY_CATEGORIES.map((category) => {
            const caps = data.capabilities.filter((c) => c.category === category);
            if (caps.length === 0) return null;
            return <CategoryGroup key={category} category={category} capabilities={caps} />;
          })}
        </div>
      )}
    </section>
  );
}

function CategoryGroup({
  category,
  capabilities,
}: {
  category: CapabilityCategory;
  capabilities: CapabilitySummary[];
}) {
  const t = useTranslation();
  return (
    <div data-testid={`readiness-category-${category}`}>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
        {t(`feature.admin.readiness.category.${category}` as const)}
      </h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {capabilities.map((c) => (
          <CapabilityCard key={c.key} capability={c} />
        ))}
      </div>
    </div>
  );
}

function CapabilityCard({ capability: c }: Readonly<{ capability: CapabilitySummary }>) {
  const t = useTranslation();
  return (
    <div data-testid={`readiness-cap-${c.key}`}>
      <Card>
        <CardBody className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-medium text-fg">
              {t(`feature.admin.readiness.cap.${c.key}.label` as const)}
            </h3>
            <div className="flex shrink-0 items-center gap-2">
              {c.implementationStatus !== "implemented" && (
                <Badge variant="secondary" data-testid={`readiness-cap-${c.key}-impl`}>
                  {t(`feature.admin.readiness.impl.${c.implementationStatus}` as const)}
                </Badge>
              )}
              <Badge
                variant={READINESS_VARIANT[c.readiness]}
                data-testid={`readiness-cap-${c.key}-status`}
              >
                {t(`feature.admin.readiness.status.${c.readiness}` as const)}
              </Badge>
            </div>
          </div>
          <p className="text-sm text-fg-muted">
            {t(`feature.admin.readiness.cap.${c.key}.description` as const)}
          </p>
          {c.detailKey && ATTENTION.has(c.readiness) && (
            <p className="text-sm text-fg" data-testid={`readiness-cap-${c.key}-action`}>
              {t(c.detailKey)}
            </p>
          )}
          {c.adminRoute && (
            <Link
              to={c.adminRoute}
              className="text-sm font-medium text-primary"
              data-testid={`readiness-cap-${c.key}-link`}
            >
              {t("feature.admin.readiness.manage")}
            </Link>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
