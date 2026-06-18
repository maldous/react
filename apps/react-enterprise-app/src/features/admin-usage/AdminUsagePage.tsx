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
  EntitlementKey,
  MeterKey,
  QuotaSummary,
  QuotaWindow,
  UsageItem,
} from "@platform/contracts-admin";
import { useSession } from "../../hooks/use-session";
import { AdminSectionHeader } from "../../components/AdminLayout";
import { AdminQueryError } from "../admin/AdminQueryError";
import { useTenantLookup } from "../admin-entitlements/use-admin-entitlements";
import {
  useMyQuotas,
  useMyUsage,
  useSetQuota,
  useTenantQuotas,
  useTenantUsage,
} from "./use-admin-usage";

// Meter → gating entitlement (mirrors the server METER_CATALOG). Used by the operator
// set-quota form to derive entitlementKey from the chosen meter.
const METERS: { meterKey: MeterKey; entitlementKey: EntitlementKey; label: string }[] = [
  { meterKey: "webhooks.deliveries", entitlementKey: "webhooks", label: "Webhook deliveries" },
  { meterKey: "storage.bytes", entitlementKey: "storage", label: "Storage bytes" },
  { meterKey: "custom_domains.count", entitlementKey: "custom_domains", label: "Custom domains" },
  {
    meterKey: "observability.log_queries",
    entitlementKey: "advanced_observability",
    label: "Log queries",
  },
];
const WINDOWS: QuotaWindow[] = ["daily", "monthly", "rolling_30d", "lifetime"];

function QuotaStateBadge({ state }: Readonly<{ state: QuotaSummary["state"] }>) {
  const t = useTranslation();
  return (
    <Badge variant={state === "within" ? "default" : "secondary"}>
      {t(`feature.admin.usage.quotaState.${state}`)}
    </Badge>
  );
}

function useUsageColumns(): ColumnDef<UsageItem>[] {
  const t = useTranslation();
  return useMemo(
    () => [
      {
        header: t("feature.admin.usage.colMeter"),
        accessorKey: "meterKey",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-fg">{row.original.displayName}</div>
            <div className="text-xs text-fg-muted">{row.original.meterKey}</div>
          </div>
        ),
      },
      { header: t("feature.admin.usage.colWindow"), accessorKey: "window" },
      { header: t("feature.admin.usage.colUsage"), accessorKey: "usage" },
    ],
    [t]
  );
}

function useQuotaColumns(): ColumnDef<QuotaSummary>[] {
  const t = useTranslation();
  return useMemo(
    () => [
      { header: t("feature.admin.usage.colQuota"), accessorKey: "quotaKey" },
      { header: t("feature.admin.usage.colMeter"), accessorKey: "meterKey" },
      {
        header: t("feature.admin.usage.colLimit"),
        accessorKey: "limit",
        cell: ({ row }) => `${row.original.usage} / ${row.original.limit} (${row.original.window})`,
      },
      {
        header: t("feature.admin.usage.colState"),
        accessorKey: "state",
        cell: ({ row }) => <QuotaStateBadge state={row.original.state} />,
      },
    ],
    [t]
  );
}

function SetQuotaForm({ tenantId }: Readonly<{ tenantId: string }>) {
  const t = useTranslation();
  const setQuota = useSetQuota(tenantId);
  const [meterKey, setMeterKey] = useState<MeterKey>("webhooks.deliveries");
  const [window, setWindow] = useState<QuotaWindow>("lifetime");
  const [limit, setLimit] = useState("10");

  const meterItems: SelectItem[] = METERS.map((m) => ({ id: m.meterKey, label: m.label }));
  const windowItems: SelectItem[] = WINDOWS.map((w) => ({ id: w, label: w }));

  function submit() {
    const entitlementKey = METERS.find((m) => m.meterKey === meterKey)!.entitlementKey;
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 0) return;
    setQuota.mutate({
      quotaKey: meterKey,
      entitlementKey,
      meterKey,
      limit: n,
      window,
      action: "deny",
    });
  }

  return (
    <Card>
      <CardBody>
        <h3 className="mb-3 text-sm font-semibold text-fg">{t("feature.admin.usage.setQuota")}</h3>
        <div className="flex flex-wrap items-end gap-3" data-testid="usage-set-form">
          <div className="min-w-48">
            <Select
              items={meterItems}
              placeholder={t("feature.admin.usage.meterLabel")}
              aria-label={t("feature.admin.usage.meterLabel")}
              selectedKey={meterKey}
              onSelectionChange={(k) => setMeterKey(String(k) as MeterKey)}
              data-testid="usage-set-meter"
            />
          </div>
          <div className="w-40">
            <Select
              items={windowItems}
              placeholder={t("feature.admin.usage.windowLabel")}
              aria-label={t("feature.admin.usage.windowLabel")}
              selectedKey={window}
              onSelectionChange={(k) => setWindow(String(k) as QuotaWindow)}
              data-testid="usage-set-window"
            />
          </div>
          <div className="w-32">
            <FormField
              label={t("feature.admin.usage.limitLabel")}
              value={limit}
              onChange={setLimit}
              name="limit"
              inputProps={{ inputMode: "numeric", "data-testid": "usage-set-limit" }}
            />
          </div>
          <Button
            size="sm"
            onPress={submit}
            isDisabled={setQuota.isPending}
            data-testid="usage-set-submit"
          >
            {t("feature.admin.usage.save")}
          </Button>
        </div>
        {setQuota.isError && (
          <p role="alert" className="mt-2 text-sm text-danger" data-testid="usage-set-error">
            {t("feature.admin.usage.saveError")}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function OperatorConsole() {
  const t = useTranslation();
  const [tenantId, setTenantId] = useState("");
  const tenants = useTenantLookup();
  const usage = useTenantUsage(tenantId);
  const quotas = useTenantQuotas(tenantId);
  const usageColumns = useUsageColumns();
  const quotaColumns = useQuotaColumns();
  const tenantItems: SelectItem[] = useMemo(
    () =>
      (tenants.data?.tenants ?? []).map((tn) => ({
        id: tn.id,
        label: `${tn.slug} — ${tn.displayName}`,
      })),
    [tenants.data]
  );

  return (
    <div className="space-y-4">
      <div className="max-w-md" data-testid="usage-tenant-form">
        <label className="mb-1 block text-sm font-medium text-fg" id="usage-tenant-label">
          {t("feature.admin.usage.tenantSelectLabel")}
        </label>
        <Select
          items={tenantItems}
          placeholder={t("feature.admin.usage.tenantSelectPlaceholder")}
          aria-labelledby="usage-tenant-label"
          selectedKey={tenantId || null}
          onSelectionChange={(k) => setTenantId(k == null ? "" : String(k))}
          data-testid="usage-tenant-select"
        />
      </div>

      {tenantId === "" ? (
        <EmptyState title={t("feature.admin.usage.enterTenant")} />
      ) : (
        <>
          <SetQuotaForm tenantId={tenantId} />
          {quotas.isLoading ? (
            <LoadingState message={t("auth.status.loading")} />
          ) : quotas.isError ? (
            <AdminQueryError error={quotas.error} onRetry={() => void quotas.refetch()} />
          ) : quotas.data && quotas.data.quotas.length > 0 ? (
            <Card>
              <CardBody>
                <DataTable data={quotas.data.quotas} columns={quotaColumns} rowTestId="quota-row" />
              </CardBody>
            </Card>
          ) : (
            <EmptyState title={t("feature.admin.usage.noQuotas")} />
          )}
          {usage.data && (
            <Card>
              <CardBody>
                <DataTable data={usage.data.usage} columns={usageColumns} rowTestId="usage-row" />
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function TenantReadOnlyView() {
  const t = useTranslation();
  const usage = useMyUsage();
  const quotas = useMyQuotas();
  const usageColumns = useUsageColumns();
  const quotaColumns = useQuotaColumns();

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted" data-testid="usage-readonly-note">
        {t("feature.admin.usage.readOnlyNote")}
      </p>
      {usage.isLoading ? (
        <LoadingState message={t("auth.status.loading")} />
      ) : usage.isError ? (
        <AdminQueryError error={usage.error} onRetry={() => void usage.refetch()} />
      ) : usage.data ? (
        <Card>
          <CardBody>
            <DataTable data={usage.data.usage} columns={usageColumns} rowTestId="usage-row" />
          </CardBody>
        </Card>
      ) : null}
      {quotas.data && quotas.data.quotas.length > 0 && (
        <Card>
          <CardBody>
            <DataTable data={quotas.data.quotas} columns={quotaColumns} rowTestId="quota-row" />
          </CardBody>
        </Card>
      )}
    </div>
  );
}

export function AdminUsagePage() {
  const t = useTranslation();
  const { hasPermission } = useSession();
  const canWrite = hasPermission("platform.quotas.write");
  return (
    <section data-testid="admin-usage">
      <AdminSectionHeader
        heading={t("feature.admin.usage.title")}
        description={t("feature.admin.usage.description")}
      />
      {canWrite ? <OperatorConsole /> : <TenantReadOnlyView />}
    </section>
  );
}
