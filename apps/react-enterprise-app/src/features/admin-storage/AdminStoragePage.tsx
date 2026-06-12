import {
  Card,
  CardBody,
  Badge,
  Button,
  LoadingState,
  LiveRegion,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import { useSession } from "../../hooks/use-session";
import { AdminQueryError } from "../admin/AdminQueryError";
import { useStorageReadiness, useRunStorageProbe } from "./use-admin-storage";
import type { TenantStorageReadinessStatus } from "./admin-storage-client";

/**
 * Tenant object storage readiness panel (ADR-0049). Read-only unless the actor
 * holds `tenant.storage.write`. Never shows credentials or a file browser —
 * readiness and isolation status only.
 */
export function AdminStoragePage() {
  const t = useTranslation();
  const { hasPermission } = useSession();
  const canWrite = hasPermission("tenant.storage.write");
  const { data, isLoading, isError, error, refetch } = useStorageReadiness();
  const probe = useRunStorageProbe();

  if (isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (isError) return <AdminQueryError error={error} onRetry={() => void refetch()} />;

  const statusTone = readinessTone(data!.status);

  return (
    <div className="space-y-6" data-testid="admin-storage">
      <header>
        <h1 className="text-lg font-semibold text-fg">{t("feature.admin.storage.title")}</h1>
        <p className="text-sm text-fg-muted">{t("feature.admin.storage.description")}</p>
      </header>

      <Card>
        <CardBody className="space-y-4">
          <p className="text-sm font-medium text-fg">
            {t("feature.admin.storage.readinessHeading")}
          </p>

          <div className="flex items-center gap-2">
            <Badge
              variant={statusTone === "success" ? "default" : "secondary"}
              data-testid="admin-storage-readiness-badge"
            >
              {data!.status}
            </Badge>
            <span className="text-sm text-fg-muted" data-testid="admin-storage-readiness-text">
              {t(`feature.admin.storage.readiness.${data!.status}`)}
            </span>
          </div>

          <dl className="space-y-2 text-sm">
            <div className="flex items-center gap-3">
              <dt className="font-medium text-fg">{t("feature.admin.storage.prefixLabel")}:</dt>
              <dd className="font-mono text-fg-muted" data-testid="admin-storage-prefix">
                {data!.prefix}
              </dd>
            </div>
            <div className="flex items-center gap-3">
              <dt className="font-medium text-fg">{t("feature.admin.storage.isolationLabel")}:</dt>
              <dd data-testid="admin-storage-isolation">
                <Badge variant={data!.isolationEnforced ? "default" : "secondary"}>
                  {data!.isolationEnforced
                    ? t("feature.admin.storage.isolationEnforced")
                    : t("feature.admin.storage.isolationNotEnforced")}
                </Badge>
              </dd>
            </div>
          </dl>

          {canWrite && (
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                type="button"
                isDisabled={probe.isPending}
                onPress={() => probe.mutate()}
                data-testid="admin-storage-probe-button"
              >
                {t("feature.admin.storage.probeButton")}
              </Button>
              <LiveRegion
                tone="polite"
                className="text-sm text-success"
                data-testid="admin-storage-probe-announce"
              >
                {probe.isSuccess ? t("feature.admin.storage.probeDone") : ""}
              </LiveRegion>
              {probe.isError && (
                <p
                  role="alert"
                  className="text-sm text-danger"
                  data-testid="admin-storage-probe-error"
                >
                  {t("feature.admin.storage.probeError")}
                </p>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function readinessTone(status: TenantStorageReadinessStatus): "success" | "warning" | "secondary" {
  if (status === "configured") return "success";
  if (status === "provider_unreachable" || status === "isolation_failed") return "warning";
  return "secondary";
}
