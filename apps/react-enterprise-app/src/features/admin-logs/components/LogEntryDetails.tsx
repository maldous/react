import { Button } from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import type { LogEntry } from "../admin-logs-client";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Expanded-row details: correlation id copy actions + the raw structured line. */
export function LogEntryDetails({ entry }: Readonly<{ entry: LogEntry }>) {
  const t = useTranslation();
  const requestId = asString(entry.fields["requestId"]);
  const traceId = asString(entry.fields["traceId"]);

  const pretty = (() => {
    try {
      return JSON.stringify(JSON.parse(entry.line), null, 2);
    } catch {
      return entry.line;
    }
  })();

  return (
    <div data-testid="logs-row-details">
      <div className="mb-2 flex flex-wrap gap-2">
        {requestId && (
          <Button
            variant="outline"
            size="sm"
            onPress={() => void navigator.clipboard.writeText(requestId)}
            data-testid="copy-request-id"
          >
            {t("feature.adminLogs.copyRequestId")}
          </Button>
        )}
        {traceId && (
          <Button
            variant="outline"
            size="sm"
            onPress={() => void navigator.clipboard.writeText(traceId)}
            data-testid="copy-trace-id"
          >
            {t("feature.adminLogs.copyTraceId")}
          </Button>
        )}
      </div>
      <pre className="overflow-x-auto rounded bg-gray-900 p-3 text-xs leading-relaxed text-gray-100">
        {pretty}
      </pre>
    </div>
  );
}
