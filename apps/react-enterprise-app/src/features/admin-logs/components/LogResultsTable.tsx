import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, Button } from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import type { LogEntry } from "../admin-logs-client";
import { LogLevelBadge } from "./LogLevelBadge";
import { LogEntryDetails } from "./LogEntryDetails";

function messageOf(entry: LogEntry): string {
  return typeof entry.fields["msg"] === "string" ? (entry.fields["msg"] as string) : entry.line;
}

export function LogResultsTable({ entries }: { entries: LogEntry[] }) {
  const t = useTranslation();

  const columns = useMemo<ColumnDef<LogEntry>[]>(
    () => [
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
            level={row.original.labels["level"] ?? String(row.original.fields["level"] ?? "")}
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
    ],
    [t]
  );

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
