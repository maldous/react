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
import type { DeadLetterSummary, EventSummary, WorkerSummary } from "@platform/contracts-admin";
import { AdminSectionHeader } from "../../components/AdminLayout";
import { AdminQueryError } from "../admin/AdminQueryError";
import { useTenantLookup } from "../admin-entitlements/use-admin-entitlements";
import { useDeadLetters, useEvents, useRedriveEvent, useWorkers } from "./use-admin-events";

function useEventColumns(): ColumnDef<EventSummary>[] {
  const t = useTranslation();
  return useMemo(
    () => [
      { header: t("feature.admin.events.colType"), accessorKey: "eventType" },
      {
        header: t("feature.admin.events.colStatus"),
        accessorKey: "status",
        cell: ({ row }) => (
          <Badge variant={row.original.status === "processed" ? "default" : "secondary"}>
            {row.original.status}
          </Badge>
        ),
      },
      {
        header: t("feature.admin.events.colAttempts"),
        accessorKey: "attempts",
        cell: ({ row }) => `${row.original.attempts} / ${row.original.maxAttempts}`,
      },
    ],
    [t]
  );
}

function WorkersCard() {
  const t = useTranslation();
  const workers = useWorkers();
  const columns: ColumnDef<WorkerSummary>[] = useMemo(
    () => [
      { header: t("feature.admin.events.colWorker"), accessorKey: "workerId" },
      { header: t("feature.admin.events.colKind"), accessorKey: "workerKind" },
      {
        header: t("feature.admin.events.colWorkerStatus"),
        accessorKey: "status",
        cell: ({ row }) => (
          <Badge variant={row.original.status === "alive" ? "default" : "secondary"}>
            {row.original.status}
          </Badge>
        ),
      },
      {
        header: t("feature.admin.events.colHeartbeat"),
        accessorKey: "secondsSinceHeartbeat",
        cell: ({ row }) =>
          t("feature.admin.events.secondsAgo", { s: row.original.secondsSinceHeartbeat }),
      },
    ],
    [t]
  );
  return (
    <Card>
      <CardBody>
        <h2 className="mb-2 text-sm font-semibold text-fg">
          {t("feature.admin.events.workersTitle")}
        </h2>
        {workers.isLoading ? (
          <LoadingState message={t("auth.status.loading")} />
        ) : workers.isError ? (
          <AdminQueryError error={workers.error} onRetry={() => void workers.refetch()} />
        ) : workers.data && workers.data.workers.length > 0 ? (
          <DataTable data={workers.data.workers} columns={columns} rowTestId="worker-row" />
        ) : (
          <EmptyState title={t("feature.admin.events.noWorkers")} />
        )}
      </CardBody>
    </Card>
  );
}

function DeadLetterTable({ tenantId }: { tenantId: string }) {
  const t = useTranslation();
  const dlq = useDeadLetters(tenantId);
  const redrive = useRedriveEvent(tenantId);
  const columns: ColumnDef<DeadLetterSummary>[] = useMemo(
    () => [
      { header: t("feature.admin.events.colType"), accessorKey: "eventType" },
      { header: t("feature.admin.events.colAttempts"), accessorKey: "attempts" },
      {
        header: t("feature.admin.events.colError"),
        accessorKey: "lastError",
        cell: ({ row }) => row.original.lastError ?? "—",
      },
      {
        header: t("feature.admin.events.colActions"),
        id: "actions",
        cell: ({ row }) =>
          row.original.redrivenAt ? (
            <span className="text-xs text-fg-muted">{t("feature.admin.events.redriven")}</span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onPress={() => redrive.mutate(row.original.id)}
              data-testid="event-redrive"
            >
              {t("feature.admin.events.redrive")}
            </Button>
          ),
      },
    ],
    [t, redrive]
  );
  if (dlq.isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (dlq.isError) return <AdminQueryError error={dlq.error} onRetry={() => void dlq.refetch()} />;
  if (!dlq.data || dlq.data.deadLetters.length === 0)
    return <EmptyState title={t("feature.admin.events.noDeadLetters")} />;
  return <DataTable data={dlq.data.deadLetters} columns={columns} rowTestId="dlq-row" />;
}

function EventsTable({ tenantId }: { tenantId: string }) {
  const t = useTranslation();
  const events = useEvents(tenantId);
  const columns = useEventColumns();
  if (events.isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (events.isError)
    return <AdminQueryError error={events.error} onRetry={() => void events.refetch()} />;
  if (!events.data || events.data.events.length === 0)
    return <EmptyState title={t("feature.admin.events.noEvents")} />;
  return <DataTable data={events.data.events} columns={columns} rowTestId="event-row" />;
}

export function AdminEventsPage() {
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
    <section data-testid="admin-events">
      <AdminSectionHeader
        heading={t("feature.admin.events.title")}
        description={t("feature.admin.events.description")}
      />
      <div className="space-y-4">
        <WorkersCard />
        <div className="max-w-md" data-testid="events-tenant-form">
          <label className="mb-1 block text-sm font-medium text-fg" id="events-tenant-label">
            {t("feature.admin.events.tenantSelectLabel")}
          </label>
          <Select
            items={tenantItems}
            placeholder={t("feature.admin.events.tenantSelectPlaceholder")}
            aria-labelledby="events-tenant-label"
            selectedKey={tenantId || null}
            onSelectionChange={(k) => setTenantId(k == null ? "" : String(k))}
            data-testid="events-tenant-select"
          />
        </div>
        {tenantId === "" ? (
          <EmptyState title={t("feature.admin.events.enterTenant")} />
        ) : (
          <>
            <Card>
              <CardBody>
                <h2 className="mb-2 text-sm font-semibold text-fg">
                  {t("feature.admin.events.deadLetterTitle")}
                </h2>
                <DeadLetterTable tenantId={tenantId} />
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <h2 className="mb-2 text-sm font-semibold text-fg">
                  {t("feature.admin.events.eventsTitle")}
                </h2>
                <EventsTable tenantId={tenantId} />
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </section>
  );
}
