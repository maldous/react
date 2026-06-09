import { useState } from "react";
import {
  PageLayout,
  SectionHeader,
  Card,
  CardBody,
  LoadingState,
  ErrorState,
  EmptyState,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import { useLogSearch } from "./use-log-search";
import { LogSearchForm } from "./components/LogSearchForm";
import { LogResultsTable } from "./components/LogResultsTable";
import {
  paramsToFormValues,
  formValuesToParams,
  type LogSearchParams,
  type LogSearchFormValues,
} from "./admin-logs.schema";
import { paramsToBffFilters, hasActiveFilters, buildQueryContext } from "./admin-logs.query-state";

interface RequestErrorLike {
  code?: string;
}

export interface AdminLogsPageProps {
  /** Current bookmarkable search state (from the route's typed search params). */
  search: LogSearchParams;
  /** Persist a new search to the URL (bookmarkable/reproducible). */
  onSearchChange: (params: LogSearchParams) => void;
  /** Injectable for tests; defaults to Date.now in the browser. */
  now?: () => number;
}

/**
 * Admin log search page — a delivery adapter only (ADR-0001). All query
 * construction lives in admin-logs.query-state; server access in the feature
 * client/hook. The page wires the typed URL state, the form, and the results.
 */
export function AdminLogsPage({ search, onSearchChange, now = Date.now }: AdminLogsPageProps) {
  const t = useTranslation();
  const [copied, setCopied] = useState(false);

  // Snapshot the search params + the trigger time so the derived start/end (and
  // therefore the query key) are stable across renders. Seeded from the URL so a
  // bookmarked, filtered link runs immediately; null means "no search yet".
  const [submitted, setSubmitted] = useState<{ params: LogSearchParams; at: number } | null>(() =>
    hasActiveFilters(search) ? { params: search, at: now() } : null
  );

  const bffFilters = submitted ? paramsToBffFilters(submitted.params, submitted.at) : null;
  const query = useLogSearch(bffFilters);

  function handleSearch(values: LogSearchFormValues) {
    const params = formValuesToParams(values);
    onSearchChange(params);
    setSubmitted({ params, at: now() });
  }

  function handleCopyContext() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    void navigator.clipboard.writeText(buildQueryContext(search, url));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const entries = query.data?.entries ?? [];
  const errorCode = (query.error as RequestErrorLike | null)?.code;

  return (
    <PageLayout>
      <div data-testid="admin-logs-page">
        <SectionHeader
          heading={t("feature.adminLogs.title")}
          description={t("feature.adminLogs.subtitle")}
          className="mb-4"
        />

        <Card className="mb-6">
          <CardBody>
            <LogSearchForm
              defaultValues={paramsToFormValues(search)}
              onSearch={handleSearch}
              isSearching={query.isFetching}
              onCopyContext={handleCopyContext}
              copied={copied}
            />
          </CardBody>
        </Card>

        <div data-testid="admin-logs-results-region" aria-live="polite">
          {submitted === null ? (
            <EmptyState
              title={t("feature.adminLogs.prompt.title")}
              description={t("feature.adminLogs.prompt.description")}
            />
          ) : query.isFetching && !query.data ? (
            <LoadingState message={t("feature.adminLogs.searching")} />
          ) : query.isError ? (
            <ErrorState
              title={t("feature.adminLogs.error")}
              description={errorCode ?? t("feature.adminLogs.errorGeneric")}
            />
          ) : entries.length === 0 ? (
            <EmptyState
              title={t("feature.adminLogs.empty.title")}
              description={t("feature.adminLogs.empty.description")}
            />
          ) : (
            <LogResultsTable entries={entries} />
          )}
        </div>
      </div>
    </PageLayout>
  );
}
