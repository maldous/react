import { useMemo, useState, type ReactNode } from "react";
import {
  Card,
  CardBody,
  Switch,
  Select,
  type SelectItem,
  FormField,
  Button,
  Badge,
  LoadingState,
  EmptyState,
  LiveRegion,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import {
  CONFIG_CATEGORIES,
  type EffectiveConfigItem,
  type ConfigDefinitionDto,
} from "@platform/contracts-admin";
import { useSession } from "../../hooks/use-session";
import { AdminSectionHeader } from "../../components/AdminLayout";
import { AdminQueryError } from "../admin/AdminQueryError";
import { AuditTrailPanel } from "../admin/AuditTrailPanel";
import { useConfig, useSetConfigValue, useClearConfigValue } from "./use-admin-config";

/**
 * Render a config value as text exactly as before for scalars, while avoiding the
 * "[object Object]" stringification hazard for non-null object values (S6551).
 */
function asText(v: unknown): string {
  return typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "");
}

/**
 * Platform configuration (ADR-0039). Effective tenant config grouped by category;
 * type-appropriate editors (Switch / Select / field), with the value source and a
 * reset-to-default action. Write controls require the definition's permission; the
 * BFF re-enforces it. Generic substrate — not a per-feature page.
 */
export function AdminConfigPage() {
  const t = useTranslation();
  const { data, isLoading, isError, error, refetch } = useConfig();
  const setValue = useSetConfigValue();
  const clearValue = useClearConfigValue();

  const byCategory = useMemo(() => {
    const map = new Map<string, EffectiveConfigItem[]>();
    for (const item of data?.items ?? []) {
      const list = map.get(item.definition.category) ?? [];
      list.push(item);
      map.set(item.definition.category, list);
    }
    return map;
  }, [data]);

  let content: ReactNode;
  if (isLoading) {
    content = <LoadingState message={t("auth.status.loading")} />;
  } else if (isError) {
    content = <AdminQueryError error={error} onRetry={() => void refetch()} />;
  } else if (!data || data.items.length === 0) {
    content = <EmptyState title={t("feature.admin.config.empty")} />;
  } else {
    content = (
      <div className="space-y-6">
        {CONFIG_CATEGORIES.filter((c) => byCategory.has(c)).map((category) => (
          <div key={category} data-testid={`config-category-${category}`}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">
              {t(`feature.admin.config.category.${category}`)}
            </h2>
            <Card>
              <CardBody className="divide-y divide-border">
                {byCategory.get(category)!.map((item) => (
                  <ConfigItemRow
                    key={item.definition.key}
                    item={item}
                    onSet={(value) => setValue.mutate({ key: item.definition.key, value })}
                    onReset={() => clearValue.mutate(item.definition.key)}
                    busy={setValue.isPending || clearValue.isPending}
                  />
                ))}
              </CardBody>
            </Card>
          </div>
        ))}

        <Card>
          <CardBody>
            <AuditTrailPanel
              resource="config"
              heading={t("feature.admin.config.recentChanges")}
              testId="config-audit"
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <section data-testid="admin-config">
      <AdminSectionHeader
        heading={t("feature.admin.config.title")}
        description={t("feature.admin.config.description")}
      />

      {content}

      <LiveRegion tone="polite" className="mt-2 text-sm text-success" data-testid="config-status">
        {setValue.isSuccess || clearValue.isSuccess ? t("feature.admin.config.saved") : ""}
      </LiveRegion>
    </section>
  );
}

function ConfigItemRow({
  item,
  onSet,
  onReset,
  busy,
}: Readonly<{
  item: EffectiveConfigItem;
  onSet: (value: unknown) => void;
  onReset: () => void;
  busy: boolean;
}>) {
  const t = useTranslation();
  const { hasPermission } = useSession();
  const def: ConfigDefinitionDto = item.definition;
  const canWrite = hasPermission(def.requiredPermissionWrite);
  const overridden = item.source === "tenant_override";

  return (
    <div
      className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
      data-testid={`config-row-${def.key}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-fg">{t(def.labelKey)}</p>
          <Badge
            variant={overridden ? "default" : "secondary"}
            data-testid={`config-source-${def.key}`}
          >
            {overridden
              ? t("feature.admin.config.source.override")
              : t("feature.admin.config.source.default")}
          </Badge>
        </div>
        <p className="text-xs text-fg-muted">{t(def.descriptionKey)}</p>
      </div>

      <div className="flex items-center gap-2 sm:shrink-0">
        <ConfigEditor item={item} canWrite={canWrite} busy={busy} onSet={onSet} />
        {overridden && canWrite && (
          <Button
            variant="ghost"
            size="sm"
            isDisabled={busy}
            onPress={onReset}
            data-testid={`config-reset-${def.key}`}
          >
            {t("feature.admin.config.reset")}
          </Button>
        )}
      </div>
    </div>
  );
}

function ConfigEditor({
  item,
  canWrite,
  busy,
  onSet,
}: Readonly<{
  item: EffectiveConfigItem;
  canWrite: boolean;
  busy: boolean;
  onSet: (value: unknown) => void;
}>) {
  const t = useTranslation();
  const def = item.definition;
  const testId = `config-value-${def.key}`;

  if (def.valueType === "boolean") {
    return (
      <Switch
        isSelected={Boolean(item.value)}
        isDisabled={!canWrite || busy}
        onChange={(v) => onSet(v)}
        aria-label={t(def.labelKey)}
        data-testid={testId}
      />
    );
  }

  if (def.valueType === "enum") {
    const items: SelectItem[] = (def.allowedValues ?? []).map((v) => ({ id: v, label: v }));
    return (
      <Select
        items={items}
        placeholder={t(def.labelKey)}
        aria-label={t(def.labelKey)}
        selectedKey={asText(item.value)}
        isDisabled={!canWrite || busy}
        onSelectionChange={(key) => onSet(String(key))}
        className="min-w-[10rem]"
        data-testid={testId}
      />
    );
  }

  if (def.valueType === "string" || def.valueType === "number") {
    return (
      <ScalarEditor item={item} canWrite={canWrite} busy={busy} onSet={onSet} testId={testId} />
    );
  }

  // json — read-only display in this slice (no rich editor).
  return (
    <pre
      className="max-w-[16rem] overflow-auto rounded bg-surface-muted p-2 text-xs text-fg-muted"
      data-testid={testId}
    >
      {JSON.stringify(item.value, null, 2)}
    </pre>
  );
}

function ScalarEditor({
  item,
  canWrite,
  busy,
  onSet,
  testId,
}: Readonly<{
  item: EffectiveConfigItem;
  canWrite: boolean;
  busy: boolean;
  onSet: (value: unknown) => void;
  testId: string;
}>) {
  const t = useTranslation();
  const def = item.definition;
  const [draft, setDraft] = useState(asText(item.value));

  if (!canWrite) {
    return <span className="text-sm text-fg">{asText(item.value)}</span>;
  }
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSet(def.valueType === "number" ? Number(draft) : draft);
      }}
      data-testid={`config-form-${def.key}`}
    >
      <FormField
        aria-label={t(def.labelKey)}
        type={def.valueType === "number" ? "number" : "text"}
        value={draft}
        onChange={setDraft}
        inputProps={{ "data-testid": testId }}
      />
      <Button type="submit" size="sm" isDisabled={busy} data-testid={`config-save-${def.key}`}>
        {t("feature.admin.config.save")}
      </Button>
    </form>
  );
}
