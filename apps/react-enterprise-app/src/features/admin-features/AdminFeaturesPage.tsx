import {
  Card,
  CardBody,
  Switch,
  LoadingState,
  EmptyState,
  LiveRegion,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import { useSession } from "../../hooks/use-session";
import { AdminSectionHeader } from "../../components/AdminLayout";
import { AdminQueryError } from "../admin/AdminQueryError";
import { useFeatures, useToggleFeature } from "./use-admin-features";

/**
 * Feature flags section (ADR-0036). Lists per-tenant capability toggles and lets
 * a tenant admin enable/disable them. Reads `GET /api/org/features`; writes
 * `PATCH /api/org/features/:key`. The API re-checks `tenant.features.update`.
 */
export function AdminFeaturesPage() {
  const t = useTranslation();
  const { hasPermission } = useSession();
  const canUpdate = hasPermission("tenant.features.update");
  const { data, isLoading, isError, error, refetch } = useFeatures();
  const mutation = useToggleFeature();

  return (
    <section data-testid="admin-features">
      <AdminSectionHeader
        heading={t("feature.admin.features.title")}
        description={t("feature.admin.features.description")}
      />

      {(() => {
        if (isLoading) return <LoadingState message={t("auth.status.loading")} />;
        if (isError) return <AdminQueryError error={error} onRetry={() => void refetch()} />;
        if (!data || data.features.length === 0)
          return <EmptyState title={t("feature.admin.features.empty")} />;
        return (
          <Card>
            <CardBody className="divide-y divide-border">
              {data.features.map((f) => (
                <div
                  key={f.key}
                  className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
                  data-testid={`feature-row-${f.key}`}
                >
                  <div>
                    <p className="text-sm font-medium text-fg">
                      {t(`feature.admin.features.key.${f.key}`)}
                    </p>
                    <p className="text-xs text-fg-muted">
                      {t(`feature.admin.features.keyDescription.${f.key}`)}
                    </p>
                  </div>
                  <Switch
                    isSelected={f.enabled}
                    isDisabled={!canUpdate || mutation.isPending}
                    onChange={(enabled) => mutation.mutate({ key: f.key, enabled })}
                    aria-label={t(`feature.admin.features.key.${f.key}`)}
                    data-testid={`feature-toggle-${f.key}`}
                  />
                </div>
              ))}
            </CardBody>
          </Card>
        );
      })()}

      <LiveRegion tone="polite" className="mt-2 text-sm text-success" data-testid="features-status">
        {mutation.isSuccess ? t("feature.admin.features.saved") : ""}
      </LiveRegion>
    </section>
  );
}
