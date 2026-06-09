import { useState } from "react";
import { useTranslation } from "@platform/i18n-runtime";
import { useLogSearch } from "./use-log-search";
import type { LogSearchFilters } from "./admin-logs-client";

const LEVELS = ["", "trace", "debug", "info", "warn", "error", "fatal"] as const;

// Time-range presets → milliseconds back from now.
const RANGES: Array<{ key: string; ms: number }> = [
  { key: "15m", ms: 15 * 60_000 },
  { key: "1h", ms: 60 * 60_000 },
  { key: "24h", ms: 24 * 60 * 60_000 },
  { key: "7d", ms: 7 * 24 * 60 * 60_000 },
];

interface FilterFields {
  service: string;
  level: string;
  requestId: string;
  traceId: string;
  tenantId: string;
  actorId: string;
  text: string;
}

const EMPTY: FilterFields = {
  service: "",
  level: "",
  requestId: "",
  traceId: "",
  tenantId: "",
  actorId: "",
  text: "",
};

export function AdminLogsPage() {
  const t = useTranslation();
  const [fields, setFields] = useState<FilterFields>(EMPTY);
  const [rangeMs, setRangeMs] = useState<number>(RANGES[1]!.ms);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const search = useLogSearch();

  const set =
    (key: keyof FilterFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setFields((f) => ({ ...f, [key]: e.target.value }));

  function currentFilters(): LogSearchFilters {
    const now = Date.now();
    const filters: LogSearchFilters = {
      start: new Date(now - rangeMs).toISOString(),
      end: new Date(now).toISOString(),
      limit: 200,
    };
    for (const [k, v] of Object.entries(fields)) {
      if (v.trim().length > 0) (filters as Record<string, unknown>)[k] = v.trim();
    }
    return filters;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setExpanded(null);
    search.mutate(currentFilters());
  }

  async function copyQueryContext() {
    // Operator-shareable reproduction context: the active filter set.
    await navigator.clipboard.writeText(JSON.stringify(currentFilters(), null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const entries = search.data?.entries ?? [];

  return (
    <main id="main-content" className="p-8 max-w-6xl" data-testid="admin-logs">
      <h1 className="text-2xl font-semibold mb-6">{t("feature.adminLogs.title")}</h1>

      <form onSubmit={onSubmit} className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Field label={t("feature.adminLogs.filter.service")} id="service">
          <input
            id="service"
            className="border rounded px-2 py-1 w-full"
            value={fields.service}
            onChange={set("service")}
            data-testid="filter-service"
          />
        </Field>
        <Field label={t("feature.adminLogs.filter.level")} id="level">
          <select
            id="level"
            className="border rounded px-2 py-1 w-full"
            value={fields.level}
            onChange={set("level")}
            data-testid="filter-level"
          >
            {LEVELS.map((l) => (
              <option key={l || "any"} value={l}>
                {l === "" ? t("feature.adminLogs.filter.anyLevel") : l}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("feature.adminLogs.filter.timeRange")} id="range">
          <select
            id="range"
            className="border rounded px-2 py-1 w-full"
            value={String(rangeMs)}
            onChange={(e) => setRangeMs(Number(e.target.value))}
            data-testid="filter-range"
          >
            {RANGES.map((r) => (
              <option key={r.key} value={r.ms}>
                {r.key}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("feature.adminLogs.filter.requestId")} id="requestId">
          <input
            id="requestId"
            className="border rounded px-2 py-1 w-full"
            value={fields.requestId}
            onChange={set("requestId")}
            data-testid="filter-requestId"
          />
        </Field>
        <Field label={t("feature.adminLogs.filter.traceId")} id="traceId">
          <input
            id="traceId"
            className="border rounded px-2 py-1 w-full"
            value={fields.traceId}
            onChange={set("traceId")}
            data-testid="filter-traceId"
          />
        </Field>
        <Field label={t("feature.adminLogs.filter.tenantId")} id="tenantId">
          <input
            id="tenantId"
            className="border rounded px-2 py-1 w-full"
            value={fields.tenantId}
            onChange={set("tenantId")}
            data-testid="filter-tenantId"
          />
        </Field>
        <Field label={t("feature.adminLogs.filter.actorId")} id="actorId">
          <input
            id="actorId"
            className="border rounded px-2 py-1 w-full"
            value={fields.actorId}
            onChange={set("actorId")}
            data-testid="filter-actorId"
          />
        </Field>
        <Field label={t("feature.adminLogs.filter.text")} id="text">
          <input
            id="text"
            className="border rounded px-2 py-1 w-full"
            value={fields.text}
            onChange={set("text")}
            data-testid="filter-text"
          />
        </Field>

        <div className="col-span-2 md:col-span-4 flex gap-3 items-center">
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
            disabled={search.isPending}
            data-testid="logs-search-button"
          >
            {search.isPending ? t("feature.adminLogs.searching") : t("feature.adminLogs.search")}
          </button>
          <button
            type="button"
            onClick={copyQueryContext}
            className="px-4 py-2 border rounded"
            data-testid="copy-query-context"
          >
            {copied ? t("feature.adminLogs.copied") : t("feature.adminLogs.copyQueryContext")}
          </button>
        </div>
      </form>

      {search.isError && (
        <div role="alert" className="text-red-700 text-sm mb-3" data-testid="logs-error">
          ⚠ {t("feature.adminLogs.error")}
        </div>
      )}

      {search.isSuccess && entries.length === 0 && (
        <p className="text-sm text-gray-500" data-testid="logs-empty">
          {t("feature.adminLogs.noResults")}
        </p>
      )}

      {entries.length > 0 && (
        <table className="w-full text-sm border-collapse" data-testid="logs-table">
          <thead>
            <tr className="text-left border-b">
              <th className="py-1 pr-3">{t("feature.adminLogs.column.time")}</th>
              <th className="py-1 pr-3">{t("feature.adminLogs.column.service")}</th>
              <th className="py-1 pr-3">{t("feature.adminLogs.column.level")}</th>
              <th className="py-1">{t("feature.adminLogs.column.message")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => {
              const msg =
                typeof entry.fields["msg"] === "string"
                  ? (entry.fields["msg"] as string)
                  : entry.line;
              const isOpen = expanded === i;
              return (
                <tr
                  key={`${entry.timestamp}-${i}`}
                  className="border-b align-top cursor-pointer hover:bg-gray-50"
                  onClick={() => setExpanded(isOpen ? null : i)}
                  data-testid="logs-row"
                >
                  <td className="py-1 pr-3 whitespace-nowrap font-mono text-xs">
                    {entry.timestamp}
                  </td>
                  <td className="py-1 pr-3">{entry.labels["service"] ?? ""}</td>
                  <td className="py-1 pr-3">
                    {entry.labels["level"] ?? String(entry.fields["level"] ?? "")}
                  </td>
                  <td className="py-1">
                    <div className="truncate max-w-2xl">{msg}</div>
                    {isOpen && (
                      <pre
                        className="mt-1 p-2 bg-gray-100 rounded text-xs overflow-x-auto"
                        data-testid="logs-row-json"
                      >
                        {entry.line}
                      </pre>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium mb-1 text-gray-600">
        {label}
      </label>
      {children}
    </div>
  );
}
