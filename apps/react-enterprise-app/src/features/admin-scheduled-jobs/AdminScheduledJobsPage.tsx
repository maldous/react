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
  Select,
  type SelectItem,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import type { ScheduledJobSummary } from "@platform/contracts-admin";
import { AdminSectionHeader } from "../../components/AdminLayout";
import { AdminQueryError } from "../admin/AdminQueryError";
import { useTenantLookup } from "../admin-entitlements/use-admin-entitlements";
import {
  useCreateScheduledJob,
  useRunScheduledJob,
  useScheduledJobs,
  useSetScheduledJobEnabled,
} from "./use-admin-scheduled-jobs";

type Translate = ReturnType<typeof useTranslation>;

function buildJobColumns(
  t: Translate,
  run: ReturnType<typeof useRunScheduledJob>,
  toggle: ReturnType<typeof useSetScheduledJobEnabled>
): ColumnDef<ScheduledJobSummary>[] {
  return [
    { header: t("feature.admin.scheduledJobs.colJob"), accessorKey: "jobKey" },
    { header: t("feature.admin.scheduledJobs.colEvent"), accessorKey: "eventType" },
    {
      header: t("feature.admin.scheduledJobs.colInterval"),
      accessorKey: "intervalSeconds",
      cell: ({ row }) => `${row.original.intervalSeconds}s`,
    },
    {
      header: t("feature.admin.scheduledJobs.colState"),
      accessorKey: "enabled",
      cell: ({ row }) => (
        <Badge variant={row.original.enabled ? "default" : "secondary"}>
          {row.original.enabled
            ? t("feature.admin.scheduledJobs.enabled")
            : t("feature.admin.scheduledJobs.paused")}
        </Badge>
      ),
    },
    {
      header: t("feature.admin.scheduledJobs.colActions"),
      id: "actions",
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onPress={() => run.mutate(row.original.id)}
            data-testid="job-run"
          >
            {t("feature.admin.scheduledJobs.runNow")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={() =>
              toggle.mutate({ jobId: row.original.id, enabled: !row.original.enabled })
            }
            data-testid="job-toggle"
          >
            {row.original.enabled
              ? t("feature.admin.scheduledJobs.pause")
              : t("feature.admin.scheduledJobs.resume")}
          </Button>
        </div>
      ),
    },
  ];
}

function JobsCard({ tenantId }: Readonly<{ tenantId: string }>) {
  const t = useTranslation();
  const jobs = useScheduledJobs(tenantId);
  const create = useCreateScheduledJob(tenantId);
  const run = useRunScheduledJob(tenantId);
  const toggle = useSetScheduledJobEnabled(tenantId);
  const [jobKey, setJobKey] = useState("");
  const [eventType, setEventType] = useState("");
  const [interval, setInterval] = useState("3600");

  function submit() {
    const n = Number(interval);
    if (!jobKey.trim() || !eventType.trim() || !Number.isInteger(n) || n <= 0) return;
    create.mutate({
      organisationId: tenantId,
      jobKey: jobKey.trim(),
      eventType: eventType.trim(),
      intervalSeconds: n,
    });
  }

  const columns: ColumnDef<ScheduledJobSummary>[] = useMemo(
    () => buildJobColumns(t, run, toggle),
    [t, run, toggle]
  );

  const renderJobs = () => {
    if (jobs.isError)
      return <AdminQueryError error={jobs.error} onRetry={() => void jobs.refetch()} />;
    if (jobs.data && jobs.data.jobs.length > 0)
      return <DataTable data={jobs.data.jobs} columns={columns} rowTestId="job-row" />;
    return <EmptyState title={t("feature.admin.scheduledJobs.noJobs")} />;
  };

  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 text-sm font-semibold text-fg">
          {t("feature.admin.scheduledJobs.jobsTitle")}
        </h2>
        <div className="mb-3 flex flex-wrap items-end gap-3" data-testid="job-create-form">
          <div className="w-40">
            <FormField
              label={t("feature.admin.scheduledJobs.jobKey")}
              value={jobKey}
              onChange={setJobKey}
              name="jobKey"
              inputProps={{ "data-testid": "job-key" }}
            />
          </div>
          <div className="w-44">
            <FormField
              label={t("feature.admin.scheduledJobs.eventType")}
              value={eventType}
              onChange={setEventType}
              name="eventType"
              inputProps={{ "data-testid": "job-event-type" }}
            />
          </div>
          <div className="w-32">
            <FormField
              label={t("feature.admin.scheduledJobs.intervalSeconds")}
              value={interval}
              onChange={setInterval}
              name="interval"
              inputProps={{ inputMode: "numeric", "data-testid": "job-interval" }}
            />
          </div>
          <Button
            size="sm"
            onPress={submit}
            isDisabled={create.isPending}
            data-testid="job-create-submit"
          >
            {t("feature.admin.scheduledJobs.create")}
          </Button>
        </div>
        {renderJobs()}
      </CardBody>
    </Card>
  );
}

export function AdminScheduledJobsPage() {
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
    <section data-testid="admin-scheduled-jobs">
      <AdminSectionHeader
        heading={t("feature.admin.scheduledJobs.title")}
        description={t("feature.admin.scheduledJobs.description")}
      />
      <div className="space-y-4">
        <div className="max-w-md" data-testid="jobs-tenant-form">
          <label className="mb-1 block text-sm font-medium text-fg" id="jobs-tenant-label">
            {t("feature.admin.scheduledJobs.tenantSelectLabel")}
          </label>
          <Select
            items={tenantItems}
            placeholder={t("feature.admin.scheduledJobs.tenantSelectPlaceholder")}
            aria-labelledby="jobs-tenant-label"
            selectedKey={tenantId || null}
            onSelectionChange={(k) => setTenantId(k == null ? "" : String(k))}
            data-testid="jobs-tenant-select"
          />
        </div>
        {tenantId === "" ? (
          <EmptyState title={t("feature.admin.scheduledJobs.enterTenant")} />
        ) : (
          <JobsCard tenantId={tenantId} />
        )}
      </div>
    </section>
  );
}
