import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, FormField, Select, type SelectItem } from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import {
  LogSearchFormSchema,
  LOG_LEVELS,
  LOG_RANGES,
  type LogSearchFormValues,
} from "../admin-logs.schema";

// Text filters rendered as labelled fields. organisationId/limit/direction are
// supported by the schema/client but intentionally not surfaced here to keep the
// operator form focused (ADR-ACT-0195 testid set).
const TEXT_FIELDS = [
  { name: "service", testId: "filter-service", labelKey: "service" },
  { name: "requestId", testId: "filter-request-id", labelKey: "requestId" },
  { name: "traceId", testId: "filter-trace-id", labelKey: "traceId" },
  { name: "tenantId", testId: "filter-tenant-id", labelKey: "tenantId" },
  { name: "actorId", testId: "filter-actor-id", labelKey: "actorId" },
  { name: "text", testId: "filter-text", labelKey: "text" },
] as const;

const LEVEL_ANY = "any";

export interface LogSearchFormProps {
  defaultValues: LogSearchFormValues;
  onSearch: (values: LogSearchFormValues) => void;
  isSearching?: boolean;
  onCopyContext: () => void;
  copied?: boolean;
}

export function LogSearchForm({
  defaultValues,
  onSearch,
  isSearching,
  onCopyContext,
  copied,
}: LogSearchFormProps) {
  const t = useTranslation();
  const { control, handleSubmit } = useForm<LogSearchFormValues>({
    resolver: zodResolver(LogSearchFormSchema),
    defaultValues,
  });

  const levelItems: SelectItem[] = [
    { id: LEVEL_ANY, label: t("feature.adminLogs.filter.anyLevel") },
    ...LOG_LEVELS.map((l) => ({ id: l, label: l })),
  ];
  const rangeItems: SelectItem[] = LOG_RANGES.map((r) => ({ id: r, label: r }));

  return (
    <form
      onSubmit={handleSubmit(onSearch)}
      data-testid="admin-logs-search-form"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      {TEXT_FIELDS.map((f) => (
        <div key={f.name} data-testid={f.testId}>
          <Controller
            name={f.name}
            control={control}
            render={({ field }) => (
              <FormField
                label={t(`feature.adminLogs.filter.${f.labelKey}`)}
                value={field.value}
                onChange={field.onChange}
                name={field.name}
              />
            )}
          />
        </div>
      ))}

      <div data-testid="filter-level" className="flex flex-col gap-1.5">
        <span id="logs-level-label" className="text-sm font-medium text-gray-900">
          {t("feature.adminLogs.filter.level")}
        </span>
        <Controller
          name="level"
          control={control}
          render={({ field }) => (
            <Select
              aria-labelledby="logs-level-label"
              items={levelItems}
              placeholder={t("feature.adminLogs.filter.anyLevel")}
              selectedKey={field.value === "" ? LEVEL_ANY : field.value}
              onSelectionChange={(key) => field.onChange(key === LEVEL_ANY ? "" : String(key))}
            />
          )}
        />
      </div>

      <div data-testid="filter-range" className="flex flex-col gap-1.5">
        <span id="logs-range-label" className="text-sm font-medium text-gray-900">
          {t("feature.adminLogs.filter.timeRange")}
        </span>
        <Controller
          name="range"
          control={control}
          render={({ field }) => (
            <Select
              aria-labelledby="logs-range-label"
              items={rangeItems}
              placeholder={t("feature.adminLogs.filter.timeRange")}
              selectedKey={field.value}
              onSelectionChange={(key) => field.onChange(String(key))}
            />
          )}
        />
      </div>

      <div className="col-span-full flex flex-wrap gap-3 pt-1">
        <Button type="submit" isDisabled={isSearching} data-testid="logs-search-button">
          {isSearching ? t("feature.adminLogs.searching") : t("feature.adminLogs.search")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onPress={onCopyContext}
          data-testid="logs-copy-context-button"
        >
          {copied ? t("feature.adminLogs.copied") : t("feature.adminLogs.copyQueryContext")}
        </Button>
      </div>
    </form>
  );
}
