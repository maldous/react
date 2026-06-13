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
import type { SearchHit, SearchResponse } from "@platform/contracts-admin";
import { useSession } from "../../hooks/use-session";
import { AdminSectionHeader } from "../../components/AdminLayout";
import { AdminQueryError } from "../admin/AdminQueryError";
import { useTenantLookup } from "../admin-entitlements/use-admin-entitlements";
import { useReindexSearch, useRunSearch, useSearchReadiness } from "./use-admin-search";

function useHitColumns(): ColumnDef<SearchHit>[] {
  const t = useTranslation();
  return useMemo(
    () => [
      {
        header: t("feature.admin.search.colTitle"),
        accessorKey: "title",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-fg">{row.original.title}</div>
            <div className="text-xs text-fg-muted">
              {row.original.documentType} · {row.original.documentId}
            </div>
          </div>
        ),
      },
      {
        header: t("feature.admin.search.colUrl"),
        accessorKey: "url",
        cell: ({ row }) => row.original.url ?? "—",
      },
      {
        header: t("feature.admin.search.colScore"),
        accessorKey: "score",
        cell: ({ row }) => row.original.score.toFixed(3),
      },
    ],
    [t]
  );
}

function TenantSearchTest() {
  const t = useTranslation();
  const search = useRunSearch();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const columns = useHitColumns();

  function submit() {
    if (q.trim().length === 0) return;
    search.mutate({ q: q.trim() }, { onSuccess: (res) => setResult(res) });
  }

  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 text-sm font-semibold text-fg">
          {t("feature.admin.search.testTitle")}
        </h2>
        <div className="flex flex-wrap items-end gap-3" data-testid="search-test-form">
          <div className="min-w-72">
            <FormField
              label={t("feature.admin.search.queryLabel")}
              value={q}
              onChange={setQ}
              name="q"
              inputProps={{ "data-testid": "search-query" }}
            />
          </div>
          <Button
            size="sm"
            onPress={submit}
            isDisabled={search.isPending}
            data-testid="search-submit"
          >
            {t("feature.admin.search.run")}
          </Button>
        </div>
        {search.isError && (
          <p role="alert" className="mt-2 text-sm text-danger" data-testid="search-error">
            {t("feature.admin.search.error")}
          </p>
        )}
        {result &&
          (result.hits.length > 0 ? (
            <div className="mt-3">
              <p className="mb-2 text-xs text-fg-muted" data-testid="search-meta">
                {t("feature.admin.search.resultMeta", {
                  total: result.total,
                  ms: result.tookMs,
                })}
              </p>
              <DataTable data={result.hits} columns={columns} rowTestId="search-hit-row" />
            </div>
          ) : (
            <div className="mt-3">
              <EmptyState title={t("feature.admin.search.noHits")} />
            </div>
          ))}
      </CardBody>
    </Card>
  );
}

function ReadinessCard() {
  const t = useTranslation();
  const readiness = useSearchReadiness(true);
  if (readiness.isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (readiness.isError)
    return <AdminQueryError error={readiness.error} onRetry={() => void readiness.refetch()} />;
  if (!readiness.data) return null;
  const r = readiness.data;
  return (
    <Card>
      <CardBody>
        <h2 className="mb-2 text-sm font-semibold text-fg">
          {t("feature.admin.search.readinessTitle")}
        </h2>
        <div className="flex items-center gap-2" data-testid="search-readiness">
          <Badge variant={r.status === "ready" ? "default" : "secondary"}>{r.status}</Badge>
          <span className="text-sm text-fg-muted">
            {r.engine} · {t("feature.admin.search.docCount", { count: r.documentCount })}
          </span>
        </div>
        <p className="mt-2 text-xs text-fg-muted">{r.detail}</p>
      </CardBody>
    </Card>
  );
}

function OperatorReindex() {
  const t = useTranslation();
  const tenants = useTenantLookup();
  const reindex = useReindexSearch();
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
    <Card>
      <CardBody>
        <h2 className="mb-3 text-sm font-semibold text-fg">
          {t("feature.admin.search.reindexTitle")}
        </h2>
        <div className="flex flex-wrap items-end gap-3" data-testid="search-reindex-form">
          <div className="min-w-72">
            <label className="mb-1 block text-sm font-medium text-fg" id="search-tenant-label">
              {t("feature.admin.search.tenantSelectLabel")}
            </label>
            <Select
              items={tenantItems}
              placeholder={t("feature.admin.search.tenantSelectPlaceholder")}
              aria-labelledby="search-tenant-label"
              selectedKey={tenantId || null}
              onSelectionChange={(k) => setTenantId(k == null ? "" : String(k))}
              data-testid="search-tenant-select"
            />
          </div>
          <Button
            size="sm"
            onPress={() => tenantId && reindex.mutate(tenantId)}
            isDisabled={!tenantId || reindex.isPending}
            data-testid="search-reindex-submit"
          >
            {t("feature.admin.search.reindex")}
          </Button>
        </div>
        {reindex.isSuccess && (
          <p className="mt-2 text-sm text-fg-muted" data-testid="search-reindex-result">
            {t("feature.admin.search.reindexResult", { count: reindex.data.reindexed })}
          </p>
        )}
        {reindex.isError && (
          <p role="alert" className="mt-2 text-sm text-danger" data-testid="search-reindex-error">
            {t("feature.admin.search.reindexError")}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

export function AdminSearchPage() {
  const t = useTranslation();
  const { hasPermission } = useSession();
  const isOperator = hasPermission("platform.search.write");
  return (
    <section data-testid="admin-search">
      <AdminSectionHeader
        heading={t("feature.admin.search.title")}
        description={t("feature.admin.search.description")}
      />
      <div className="space-y-4">
        {isOperator && <ReadinessCard />}
        <TenantSearchTest />
        {isOperator && <OperatorReindex />}
      </div>
    </section>
  );
}
