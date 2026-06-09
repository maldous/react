import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Card,
  CardBody,
  FormField,
  LiveRegion,
  LoadingState,
  EmptyState,
  ErrorState,
  SectionHeader,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import { useSession } from "../../hooks/use-session";
import { WidgetFormSchema, type WidgetFormValues } from "./feature.schema";
import { useWidgetList } from "./feature.queries";
import { useCreateWidget } from "./feature.mutations";
import { WidgetTable } from "./components/WidgetTable";

/**
 * Canonical dumb feature page (ADR-ACT-0203). Composes feature hooks with
 * design-system primitives and token classes. No GraphQL, no fetch, no `<main>`
 * (the AppShell layout owns it), i18n-only text, permission-gated actions, and
 * every async state handled: loading / empty / error / (forbidden is handled at
 * the route by RequirePermission).
 */
export function FeaturePage() {
  const { hasPermission } = useSession();
  const t = useTranslation();
  const { data: widgets, isLoading, isError } = useWidgetList();
  const create = useCreateWidget();
  const canCreate = hasPermission("widget.create");

  const { control, handleSubmit, reset } = useForm<WidgetFormValues>({
    resolver: zodResolver(WidgetFormSchema),
    defaultValues: { name: "" },
  });

  if (isLoading) return <LoadingState message={t("ui.loading.default")} />;
  if (isError)
    return (
      <ErrorState title={t("feature.widget.error.title")} description={t("ui.error.tryAgain")} />
    );

  const onSubmit = (values: WidgetFormValues) =>
    create.mutate(values, { onSuccess: () => reset({ name: "" }) });

  return (
    <section className="max-w-3xl">
      <SectionHeader heading={t("feature.widget.title")} level={1} className="mb-6" />

      {canCreate && (
        <Card className="mb-6">
          <CardBody>
            <form onSubmit={handleSubmit(onSubmit)} noValidate>
              <Controller
                name="name"
                control={control}
                render={({ field, fieldState }) => (
                  <FormField
                    label={t("feature.widget.form.name.label")}
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    isInvalid={!!fieldState.error}
                    errorMessage={fieldState.error ? t(fieldState.error.message ?? "") : undefined}
                    inputProps={{ "data-testid": "widget-name-input" }}
                  />
                )}
              />
              <div className="mt-4">
                <Button type="submit" isDisabled={create.isPending} data-testid="widget-save">
                  {create.isPending ? t("ui.action.saving") : t("ui.action.create")}
                </Button>
              </div>
              <LiveRegion tone="assertive" className="text-danger">
                {create.isError && t("ui.error.saveFailed")}
              </LiveRegion>
            </form>
          </CardBody>
        </Card>
      )}

      {!widgets || widgets.length === 0 ? (
        <EmptyState title={t("feature.widget.empty.title")} description={t("feature.widget.empty.description")} />
      ) : (
        <WidgetTable widgets={widgets} />
      )}
    </section>
  );
}
