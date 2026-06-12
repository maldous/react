import { Card, CardBody, Badge, LoadingState, LiveRegion } from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import { AdminQueryError } from "../admin/AdminQueryError";
import { useObservabilityReadiness } from "./use-admin-observability";
import type {
  TenantObservabilityReadinessStatus,
  ObservabilitySignalStatus,
} from "./admin-observability-client";

/**
 * Tenant observability readiness panel (ADR-0050). Read-only — shows log
 * ingestion, tenant-scoped query, trace correlation, and high-cardinality
 * guard status. No dashboards, no log explorer.
 */
export function AdminObservabilityPage() {
  const t = useTranslation();
  const { data, isLoading, isError, error, refetch } = useObservabilityReadiness();

  if (isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (isError) return <AdminQueryError error={error} onRetry={() => void refetch()} />;

  const statusTone = readinessTone(data!.status);

  return (
    <div className="space-y-6" data-testid="admin-observability">
      <header>
        <h1 className="text-lg font-semibold text-fg">{t("feature.admin.observability.title")}</h1>
        <p className="text-sm text-fg-muted">{t("feature.admin.observability.description")}</p>
      </header>

      <Card>
        <CardBody className="space-y-4">
          <p className="text-sm font-medium text-fg">
            {t("feature.admin.observability.readinessHeading")}
          </p>

          <div className="flex items-center gap-2">
            <Badge
              variant={statusTone === "success" ? "default" : "secondary"}
              data-testid="admin-observability-readiness-badge"
            >
              {data!.status}
            </Badge>
            <span
              className="text-sm text-fg-muted"
              data-testid="admin-observability-readiness-text"
            >
              {t(`feature.admin.observability.readiness.${data!.status}`)}
            </span>
          </div>

          <dl className="space-y-2 text-sm">
            <SignalRow
              label={t("feature.admin.observability.logIngestionLabel")}
              signal={data!.logIngestion}
              testId="admin-observability-log-ingestion"
              t={t}
            />
            <SignalRow
              label={t("feature.admin.observability.tenantQueryLabel")}
              signal={data!.tenantScopedQuery}
              testId="admin-observability-tenant-query"
              t={t}
            />
            <SignalRow
              label={t("feature.admin.observability.traceLabel")}
              signal={data!.traceCorrelation}
              testId="admin-observability-trace"
              t={t}
            />
            <SignalRow
              label={t("feature.admin.observability.metricsLabel")}
              signal={data!.metrics}
              testId="admin-observability-signal-metrics"
              t={t}
            />
            <SignalRow
              label={t("feature.admin.observability.otelLabel")}
              signal={data!.otelCollector}
              testId="admin-observability-signal-otel-collector"
              t={t}
            />
            <SignalRow
              label={t("feature.admin.observability.dashboardsLabel")}
              signal={data!.dashboards}
              testId="admin-observability-signal-dashboards"
              t={t}
            />
            <SignalRow
              label={t("feature.admin.observability.errorCaptureLabel")}
              signal={data!.errorCapture}
              testId="admin-observability-signal-error-capture"
              t={t}
            />
            <div className="flex items-center gap-3">
              <dt className="font-medium text-fg">
                {t("feature.admin.observability.guardLabel")}:
              </dt>
              <dd data-testid="admin-observability-guard">
                <Badge variant={data!.highCardinalityGuard ? "default" : "secondary"}>
                  {data!.highCardinalityGuard
                    ? t("feature.admin.observability.guardIntact")
                    : t("feature.admin.observability.guardRegressed")}
                </Badge>
              </dd>
            </div>
          </dl>

          {/* LiveRegion present for axe compliance; no mutations, so always empty. */}
          <LiveRegion tone="polite" className="sr-only" />
        </CardBody>
      </Card>
    </div>
  );
}

function SignalRow({
  label,
  signal,
  testId,
  t,
}: {
  label: string;
  signal: ObservabilitySignalStatus;
  testId: string;
  t: (key: string) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <dt className="font-medium text-fg">{label}:</dt>
      <dd data-testid={testId}>
        <Badge variant={signal === "ok" ? "default" : "secondary"}>
          {t(`feature.admin.observability.signal.${signal}`)}
        </Badge>
      </dd>
    </div>
  );
}

function readinessTone(
  status: TenantObservabilityReadinessStatus
): "success" | "warning" | "secondary" {
  if (status === "configured") return "success";
  if (status === "provider_unreachable" || status === "degraded") return "warning";
  return "secondary";
}
