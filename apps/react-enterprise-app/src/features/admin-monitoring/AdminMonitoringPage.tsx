import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Badge,
  Button,
  Card,
  CardBody,
  DataTable,
  EmptyState,
  FormField,
  LoadingState,
  Select,
  type SelectItem,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import type {
  AlertComparator,
  AlertRuleSummary,
  IncidentSummary,
  MetricSignalSummary,
} from "@platform/contracts-admin";
import { AdminSectionHeader } from "../../components/AdminLayout";
import { AdminQueryError } from "../admin/AdminQueryError";
import { useTenantLookup } from "../admin-entitlements/use-admin-entitlements";
import {
  useAlerts,
  useCreateAlert,
  useEvaluateAlert,
  useIncidents,
  useObservabilityReadiness,
  useSignals,
  useUpdateIncident,
} from "./use-admin-monitoring";

const COMPARATORS: AlertComparator[] = ["gt", "gte", "lt", "lte"];

function ReadinessCard() {
  const t = useTranslation();
  const readiness = useObservabilityReadiness(true);
  if (readiness.isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (readiness.isError)
    return <AdminQueryError error={readiness.error} onRetry={() => void readiness.refetch()} />;
  if (!readiness.data) return null;
  const r = readiness.data;
  return (
    <Card>
      <CardBody>
        <h2 className="mb-2 text-sm font-semibold text-fg">
          {t("feature.admin.monitoring.readinessTitle")}
        </h2>
        <div className="flex items-center gap-2" data-testid="monitoring-readiness">
          <Badge variant={r.status === "ready" ? "default" : "secondary"}>{r.status}</Badge>
          <span className="text-sm text-fg-muted">
            {r.backend} · {r.signalCount} signals · {r.openIncidentCount} open incidents
          </span>
        </div>
        <p className="mt-2 text-xs text-fg-muted">{r.detail}</p>
      </CardBody>
    </Card>
  );
}

function SignalsCard({ tenantId }: Readonly<{ tenantId: string }>) {
  const t = useTranslation();
  const signals = useSignals(tenantId);
  const columns: ColumnDef<MetricSignalSummary>[] = useMemo(
    () => [
      { header: t("feature.admin.monitoring.colSignal"), accessorKey: "signalKey" },
      { header: t("feature.admin.monitoring.colUnit"), accessorKey: "unit" },
      {
        header: t("feature.admin.monitoring.colLatest"),
        accessorKey: "latestValue",
        cell: ({ row }) =>
          row.original.latestValue == null ? "—" : String(row.original.latestValue),
      },
    ],
    [t]
  );
  if (signals.isError)
    return <AdminQueryError error={signals.error} onRetry={() => void signals.refetch()} />;
  return (
    <Card>
      <CardBody>
        <h2 className="mb-2 text-sm font-semibold text-fg">
          {t("feature.admin.monitoring.signalsTitle")}
        </h2>
        {signals.data && signals.data.signals.length > 0 ? (
          <DataTable data={signals.data.signals} columns={columns} rowTestId="signal-row" />
        ) : (
          <EmptyState title={t("feature.admin.monitoring.noSignals")} />
        )}
      </CardBody>
    </Card>
  );
}

function AlertsCard({ tenantId }: Readonly<{ tenantId: string }>) {
  const t = useTranslation();
  const alerts = useAlerts(tenantId);
  const create = useCreateAlert(tenantId);
  const evaluate = useEvaluateAlert(tenantId);
  const [ruleKey, setRuleKey] = useState("");
  const [signalKey, setSignalKey] = useState("");
  const [comparator, setComparator] = useState<AlertComparator>("gt");
  const [threshold, setThreshold] = useState("0");

  const comparatorItems: SelectItem[] = COMPARATORS.map((c) => ({ id: c, label: c }));

  function submit() {
    const n = Number(threshold);
    if (!ruleKey.trim() || !signalKey.trim() || Number.isNaN(n)) return;
    create.mutate({
      organisationId: tenantId,
      ruleKey: ruleKey.trim(),
      signalKey: signalKey.trim(),
      comparator,
      threshold: n,
    });
  }

  const columns: ColumnDef<AlertRuleSummary>[] = useMemo(
    () => [
      { header: t("feature.admin.monitoring.colRule"), accessorKey: "ruleKey" },
      {
        header: t("feature.admin.monitoring.colCondition"),
        id: "cond",
        cell: ({ row }) =>
          `${row.original.signalKey} ${row.original.comparator} ${row.original.threshold}`,
      },
      {
        header: t("feature.admin.monitoring.colSeverity"),
        accessorKey: "severity",
        cell: ({ row }) => <Badge variant="secondary">{row.original.severity}</Badge>,
      },
      {
        header: t("feature.admin.monitoring.colActions"),
        id: "actions",
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="ghost"
            onPress={() => evaluate.mutate(row.original.id)}
            data-testid="alert-evaluate"
          >
            {t("feature.admin.monitoring.evaluate")}
          </Button>
        ),
      },
    ],
    [t, evaluate]
  );

  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 text-sm font-semibold text-fg">
          {t("feature.admin.monitoring.alertsTitle")}
        </h2>
        <div className="mb-3 flex flex-wrap items-end gap-3" data-testid="alert-create-form">
          <div className="w-40">
            <FormField
              label={t("feature.admin.monitoring.ruleKey")}
              value={ruleKey}
              onChange={setRuleKey}
              name="ruleKey"
              inputProps={{ "data-testid": "alert-rule-key" }}
            />
          </div>
          <div className="w-40">
            <FormField
              label={t("feature.admin.monitoring.signalKey")}
              value={signalKey}
              onChange={setSignalKey}
              name="signalKey"
              inputProps={{ "data-testid": "alert-signal-key" }}
            />
          </div>
          <div className="w-28">
            <Select
              items={comparatorItems}
              placeholder={t("feature.admin.monitoring.comparator")}
              aria-label={t("feature.admin.monitoring.comparator")}
              selectedKey={comparator}
              onSelectionChange={(k) => setComparator(String(k) as AlertComparator)}
              data-testid="alert-comparator"
            />
          </div>
          <div className="w-28">
            <FormField
              label={t("feature.admin.monitoring.threshold")}
              value={threshold}
              onChange={setThreshold}
              name="threshold"
              inputProps={{ inputMode: "decimal", "data-testid": "alert-threshold" }}
            />
          </div>
          <Button
            size="sm"
            onPress={submit}
            isDisabled={create.isPending}
            data-testid="alert-create-submit"
          >
            {t("feature.admin.monitoring.createAlert")}
          </Button>
        </div>
        {alerts.isError ? (
          <AdminQueryError error={alerts.error} onRetry={() => void alerts.refetch()} />
        ) : alerts.data && alerts.data.rules.length > 0 ? (
          <DataTable data={alerts.data.rules} columns={columns} rowTestId="alert-row" />
        ) : (
          <EmptyState title={t("feature.admin.monitoring.noAlerts")} />
        )}
      </CardBody>
    </Card>
  );
}

function IncidentsCard({ tenantId }: Readonly<{ tenantId: string }>) {
  const t = useTranslation();
  const incidents = useIncidents(tenantId);
  const update = useUpdateIncident(tenantId);
  const columns: ColumnDef<IncidentSummary>[] = useMemo(
    () => [
      { header: t("feature.admin.monitoring.colIncident"), accessorKey: "title" },
      {
        header: t("feature.admin.monitoring.colStatus"),
        accessorKey: "status",
        cell: ({ row }) => (
          <Badge variant={row.original.status === "resolved" ? "default" : "secondary"}>
            {row.original.status}
          </Badge>
        ),
      },
      {
        header: t("feature.admin.monitoring.colActions"),
        id: "actions",
        cell: ({ row }) =>
          row.original.status !== "resolved" ? (
            <div className="flex gap-2">
              {row.original.status === "open" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() =>
                    update.mutate({ incidentId: row.original.id, status: "acknowledged" })
                  }
                  data-testid="incident-ack"
                >
                  {t("feature.admin.monitoring.ack")}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onPress={() => update.mutate({ incidentId: row.original.id, status: "resolved" })}
                data-testid="incident-resolve"
              >
                {t("feature.admin.monitoring.resolve")}
              </Button>
            </div>
          ) : null,
      },
    ],
    [t, update]
  );
  if (incidents.isError)
    return <AdminQueryError error={incidents.error} onRetry={() => void incidents.refetch()} />;
  return (
    <Card>
      <CardBody>
        <h2 className="mb-2 text-sm font-semibold text-fg">
          {t("feature.admin.monitoring.incidentsTitle")}
        </h2>
        {incidents.data && incidents.data.incidents.length > 0 ? (
          <DataTable data={incidents.data.incidents} columns={columns} rowTestId="incident-row" />
        ) : (
          <EmptyState title={t("feature.admin.monitoring.noIncidents")} />
        )}
      </CardBody>
    </Card>
  );
}

export function AdminMonitoringPage() {
  const t = useTranslation();
  const tenants = useTenantLookup();
  const [tenantId, setTenantId] = useState("");
  const tenantItems: SelectItem[] = useMemo(
    () =>
      (tenants.data?.tenants ?? []).map((tn) => ({
        id: tn.id,
        label: `${tn.slug} — ${tn.displayName}`,
      })),
    [tenants.data]
  );
  return (
    <section data-testid="admin-monitoring">
      <AdminSectionHeader
        heading={t("feature.admin.monitoring.title")}
        description={t("feature.admin.monitoring.description")}
      />
      <div className="space-y-4">
        <ReadinessCard />
        <div className="max-w-md" data-testid="monitoring-tenant-form">
          <label className="mb-1 block text-sm font-medium text-fg" id="monitoring-tenant-label">
            {t("feature.admin.monitoring.tenantSelectLabel")}
          </label>
          <Select
            items={tenantItems}
            placeholder={t("feature.admin.monitoring.tenantSelectPlaceholder")}
            aria-labelledby="monitoring-tenant-label"
            selectedKey={tenantId || null}
            onSelectionChange={(k) => setTenantId(k == null ? "" : String(k))}
            data-testid="monitoring-tenant-select"
          />
        </div>
        {tenantId === "" ? (
          <EmptyState title={t("feature.admin.monitoring.enterTenant")} />
        ) : (
          <>
            <SignalsCard tenantId={tenantId} />
            <AlertsCard tenantId={tenantId} />
            <IncidentsCard tenantId={tenantId} />
          </>
        )}
      </div>
    </section>
  );
}
