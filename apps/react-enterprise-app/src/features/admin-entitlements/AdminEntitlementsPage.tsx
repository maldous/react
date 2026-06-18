import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Badge,
  Button,
  Card,
  CardBody,
  DataTable,
  EmptyState,
  LoadingState,
  Select,
  type SelectItem,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import type { EntitlementSummary } from "@platform/contracts-admin";
import { useSession } from "../../hooks/use-session";
import { AdminSectionHeader } from "../../components/AdminLayout";
import { AdminQueryError } from "../admin/AdminQueryError";
import {
  useMyEntitlements,
  useSetEntitlement,
  useTenantEntitlements,
  useTenantLookup,
} from "./use-admin-entitlements";

function StateBadge({ state }: Readonly<{ state: EntitlementSummary["state"] }>) {
  const t = useTranslation();
  return (
    <Badge variant={state === "granted" ? "default" : "secondary"}>
      {t(`feature.admin.entitlements.state.${state}`)}
    </Badge>
  );
}

type Translate = ReturnType<typeof useTranslation>;

function buildOperatorColumns(args: {
  t: Translate;
  setEntitlement: ReturnType<typeof useSetEntitlement>;
}): ColumnDef<EntitlementSummary>[] {
  const { t, setEntitlement } = args;
  return [
    {
      header: t("feature.admin.entitlements.colCapability"),
      accessorKey: "key",
      cell: ({ row }) => (
        <div>
          <div className="font-medium text-fg">{row.original.displayName}</div>
          <div className="text-xs text-fg-muted">{row.original.key}</div>
        </div>
      ),
    },
    {
      header: t("feature.admin.entitlements.colCategory"),
      accessorKey: "category",
    },
    {
      header: t("feature.admin.entitlements.colState"),
      accessorKey: "state",
      cell: ({ row }) => <StateBadge state={row.original.state} />,
    },
    {
      header: t("feature.admin.entitlements.colActions"),
      id: "actions",
      cell: ({ row }) => {
        const granted = row.original.state === "granted";
        return (
          <Button
            variant="outline"
            size="sm"
            isDisabled={setEntitlement.isPending}
            onPress={() =>
              setEntitlement.mutate({
                key: row.original.key,
                state: granted ? "revoked" : "granted",
              })
            }
            data-testid={`entitlement-toggle-${row.original.key}`}
          >
            {granted
              ? t("feature.admin.entitlements.revoke")
              : t("feature.admin.entitlements.grant")}
          </Button>
        );
      },
    },
  ];
}

function buildReadOnlyColumns(t: Translate): ColumnDef<EntitlementSummary>[] {
  return [
    {
      header: t("feature.admin.entitlements.colCapability"),
      accessorKey: "key",
      cell: ({ row }) => (
        <div>
          <div className="font-medium text-fg">{row.original.displayName}</div>
          <div className="text-xs text-fg-muted">{row.original.description}</div>
        </div>
      ),
    },
    { header: t("feature.admin.entitlements.colCategory"), accessorKey: "category" },
    {
      header: t("feature.admin.entitlements.colState"),
      accessorKey: "state",
      cell: ({ row }) => <StateBadge state={row.original.state} />,
    },
  ];
}

/** System-operator console: load a tenant's entitlements and grant/revoke them. */
function OperatorConsole() {
  const t = useTranslation();
  const [tenantId, setTenantId] = useState("");
  const tenants = useTenantLookup();
  const query = useTenantEntitlements(tenantId);
  const setEntitlement = useSetEntitlement(tenantId);
  const tenantItems = useMemo<SelectItem[]>(
    () =>
      (tenants.data?.tenants ?? []).map((tn) => ({
        id: tn.id,
        label: `${tn.slug} — ${tn.displayName}`,
      })),
    [tenants.data]
  );

  const columns = useMemo<ColumnDef<EntitlementSummary>[]>(
    () => buildOperatorColumns({ t, setEntitlement }),
    [t, setEntitlement]
  );

  return (
    <div className="space-y-4">
      <div className="max-w-md" data-testid="entitlement-tenant-form">
        <label className="mb-1 block text-sm font-medium text-fg" id="entitlement-tenant-label">
          {t("feature.admin.entitlements.tenantSelectLabel")}
        </label>
        <Select
          items={tenantItems}
          placeholder={t("feature.admin.entitlements.tenantSelectPlaceholder")}
          aria-labelledby="entitlement-tenant-label"
          selectedKey={tenantId || null}
          onSelectionChange={(k) => setTenantId(k == null ? "" : String(k))}
          data-testid="entitlement-tenant-select"
        />
      </div>

      {(() => {
        if (tenantId === "")
          return <EmptyState title={t("feature.admin.entitlements.enterTenant")} />;
        if (query.isLoading) return <LoadingState message={t("auth.status.loading")} />;
        if (query.isError)
          return <AdminQueryError error={query.error} onRetry={() => void query.refetch()} />;
        if (query.data && query.data.entitlements.length > 0)
          return (
            <Card>
              <CardBody>
                <DataTable
                  data={query.data.entitlements}
                  columns={columns}
                  rowTestId="entitlement-row"
                />
              </CardBody>
            </Card>
          );
        return <EmptyState title={t("feature.admin.entitlements.empty")} />;
      })()}
      <p className="text-xs text-fg-muted" data-testid="entitlement-quota-note">
        {t("feature.admin.entitlements.quotaNote")}
      </p>
    </div>
  );
}

/** Tenant read-only view of its own entitlements. */
function TenantReadOnlyView() {
  const t = useTranslation();
  const query = useMyEntitlements();

  const columns = useMemo<ColumnDef<EntitlementSummary>[]>(() => buildReadOnlyColumns(t), [t]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted" data-testid="entitlement-readonly-note">
        {t("feature.admin.entitlements.readOnlyNote")}
      </p>
      {(() => {
        if (query.isLoading) return <LoadingState message={t("auth.status.loading")} />;
        if (query.isError)
          return <AdminQueryError error={query.error} onRetry={() => void query.refetch()} />;
        if (query.data && query.data.entitlements.length > 0)
          return (
            <Card>
              <CardBody>
                <DataTable
                  data={query.data.entitlements}
                  columns={columns}
                  rowTestId="entitlement-row"
                />
              </CardBody>
            </Card>
          );
        return <EmptyState title={t("feature.admin.entitlements.empty")} />;
      })()}
    </div>
  );
}

export function AdminEntitlementsPage() {
  const t = useTranslation();
  const { hasPermission } = useSession();
  const canWrite = hasPermission("platform.entitlements.write");

  return (
    <section data-testid="admin-entitlements">
      <AdminSectionHeader
        heading={t("feature.admin.entitlements.title")}
        description={t("feature.admin.entitlements.description")}
      />
      {canWrite ? <OperatorConsole /> : <TenantReadOnlyView />}
    </section>
  );
}
