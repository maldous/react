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
} from "./use-admin-entitlements";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function StateBadge({ state }: { state: EntitlementSummary["state"] }) {
  const t = useTranslation();
  return (
    <Badge variant={state === "granted" ? "default" : "secondary"}>
      {t(`feature.admin.entitlements.state.${state}`)}
    </Badge>
  );
}

/** System-operator console: load a tenant's entitlements and grant/revoke them. */
function OperatorConsole() {
  const t = useTranslation();
  const [draft, setDraft] = useState("");
  const [tenantId, setTenantId] = useState("");
  const query = useTenantEntitlements(tenantId);
  const setEntitlement = useSetEntitlement(tenantId);

  const columns = useMemo<ColumnDef<EntitlementSummary>[]>(
    () => [
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
    ],
    [t, setEntitlement]
  );

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (UUID_RE.test(draft.trim())) setTenantId(draft.trim());
        }}
        className="flex items-end gap-2"
        data-testid="entitlement-tenant-form"
      >
        <div className="flex-1">
          <FormField
            label={t("feature.admin.entitlements.tenantIdLabel")}
            value={draft}
            onChange={setDraft}
            name="tenantId"
            inputProps={{
              placeholder: t("feature.admin.entitlements.tenantIdPlaceholder"),
              "data-testid": "entitlement-tenant-input",
            }}
          />
        </div>
        <Button
          size="sm"
          type="submit"
          isDisabled={!UUID_RE.test(draft.trim())}
          data-testid="entitlement-tenant-load"
        >
          {t("feature.admin.entitlements.loadButton")}
        </Button>
      </form>

      {tenantId === "" ? (
        <EmptyState title={t("feature.admin.entitlements.enterTenant")} />
      ) : query.isLoading ? (
        <LoadingState message={t("auth.status.loading")} />
      ) : query.isError ? (
        <AdminQueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data && query.data.entitlements.length > 0 ? (
        <Card>
          <CardBody>
            <DataTable
              data={query.data.entitlements}
              columns={columns}
              rowTestId="entitlement-row"
            />
          </CardBody>
        </Card>
      ) : (
        <EmptyState title={t("feature.admin.entitlements.empty")} />
      )}
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

  const columns = useMemo<ColumnDef<EntitlementSummary>[]>(
    () => [
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
    ],
    [t]
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted" data-testid="entitlement-readonly-note">
        {t("feature.admin.entitlements.readOnlyNote")}
      </p>
      {query.isLoading ? (
        <LoadingState message={t("auth.status.loading")} />
      ) : query.isError ? (
        <AdminQueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data && query.data.entitlements.length > 0 ? (
        <Card>
          <CardBody>
            <DataTable
              data={query.data.entitlements}
              columns={columns}
              rowTestId="entitlement-row"
            />
          </CardBody>
        </Card>
      ) : (
        <EmptyState title={t("feature.admin.entitlements.empty")} />
      )}
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
