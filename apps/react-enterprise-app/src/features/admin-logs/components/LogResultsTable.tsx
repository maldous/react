import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, Button } from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import type { LogEntry } from "../admin-logs-client";
import { LogLevelBadge } from "./LogLevelBadge";
import { LogEntryDetails } from "./LogEntryDetails";
import { asText } from "../../../lib/as-text";

function messageOf(entry: LogEntry): string {
  return typeof entry.fields["msg"] === "string" ? entry.fields["msg"] : entry.line;
}

function buildLogColumns(t: ReturnType<typeof useTranslation>): ColumnDef<LogEntry>[] {
  return [
    {
      id: "expand",
      header: () => <span className="sr-only">{t("feature.adminLogs.column.expand")}</span>,
      enableSorting: false,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={row.getIsExpanded()}
          aria-label={t("feature.adminLogs.toggleDetails")}
          onPress={() => row.toggleExpanded()}
          data-testid="logs-row-expand"
        >
          <span aria-hidden="true">{row.getIsExpanded() ? "▾" : "▸"}</span>
        </Button>
      ),
    },
    {
      accessorKey: "timestamp",
      header: () => t("feature.adminLogs.column.time"),
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-mono text-xs">{row.original.timestamp}</span>
      ),
    },
    {
      id: "service",
      header: () => t("feature.adminLogs.column.service"),
      cell: ({ row }) => row.original.labels["service"] ?? "",
    },
    {
      id: "level",
      header: () => t("feature.adminLogs.column.level"),
      cell: ({ row }) => (
        <LogLevelBadge
          level={row.original.labels["level"] ?? asText(row.original.fields["level"])}
        />
      ),
    },
    {
      id: "message",
      header: () => t("feature.adminLogs.column.message"),
      cell: ({ row }) => (
        <span className="block max-w-md truncate sm:max-w-xl">{messageOf(row.original)}</span>
      ),
    },
  ];
}

export function LogResultsTable({ entries }: Readonly<{ entries: LogEntry[] }>) {
  const t = useTranslation();

  const columns = useMemo<ColumnDef<LogEntry>[]>(() => buildLogColumns(t), [t]);

  // Mobile strategy (ADR-ACT-0195): DataTable wraps results in a horizontally
  // safe scroll container (overflow-auto), which keeps a single rendering path.
  // PROMOTION CRITERIA: add a dedicated card/stacked fallback for narrow screens
  // ONLY if real-device testing shows the scrolling table is genuinely hard to
  // use (e.g. key cells unreadable) — do not duplicate table+card rendering
  // pre-emptively. Row expansion is a real keyboard-accessible button (no
  // hover-only affordance), so it works on touch and keyboard.
  return (
    <div data-testid="logs-results">
      <DataTable
        data={entries}
        columns={columns}
        rowTestId="logs-row"
        renderSubComponent={(row) => <LogEntryDetails entry={row.original} />}
      />
    </div>
  );
}
