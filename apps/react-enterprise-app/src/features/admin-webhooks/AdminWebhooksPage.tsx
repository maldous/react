import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Card,
  CardBody,
  Badge,
  Button,
  Checkbox,
  Switch,
  FormField,
  LoadingState,
  LiveRegion,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import {
  CreateWebhookSubscriptionRequestSchema,
  WEBHOOK_EVENT_TYPES,
  type WebhookEventType,
  type WebhookSubscriptionSummary,
  type WebhookDeliverySummary,
} from "@platform/contracts-admin";
import { useSession } from "../../hooks/use-session";
import { AdminQueryError } from "../admin/AdminQueryError";
import {
  useWebhooks,
  useWebhooksReadiness,
  useCreateWebhook,
  useDeleteWebhook,
  useRotateSecret,
  useTestWebhook,
  useWebhookDeliveries,
  useWebhookMetrics,
  useRedriveDelivery,
  useRedriveDead,
} from "./use-admin-webhooks";
import type { CreateWebhookSubscriptionResponse } from "./admin-webhooks-client";

interface AddWebhookForm {
  url: string;
  eventTypes: WebhookEventType[];
  enabled?: boolean;
}

/**
 * Tenant outbound webhooks management page (ADR-0051). Read-only unless the actor
 * holds `tenant.webhooks.write`. The signing secret is reveal-once — it is shown
 * only in the dismissible block immediately after create/rotate and is never stored
 * in a query cache or refetched.
 */
export function AdminWebhooksPage() {
  const t = useTranslation();
  const { hasPermission } = useSession();
  const canWrite = hasPermission("tenant.webhooks.write");
  const { data, isLoading, isError, error, refetch } = useWebhooks();

  if (isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (isError) return <AdminQueryError error={error} onRetry={() => void refetch()} />;

  return (
    <div className="space-y-6" data-testid="admin-webhooks">
      <header>
        <h1 className="text-lg font-semibold text-fg">{t("feature.admin.webhooks.title")}</h1>
        <p className="text-sm text-fg-muted">{t("feature.admin.webhooks.description")}</p>
      </header>

      <ReadinessBanner />
      {canWrite && <AddWebhookCard />}
      <WebhookListCard subscriptions={data!.subscriptions} canWrite={canWrite} />
    </div>
  );
}

function ReadinessBanner() {
  const t = useTranslation();
  const { data, isLoading } = useWebhooksReadiness();

  if (isLoading || !data) return null;

  const variant = data.status === "configured" ? "default" : "secondary";

  return (
    <Card>
      <CardBody>
        <p className="text-sm font-medium text-fg">
          {t("feature.admin.webhooks.readinessHeading")}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <Badge variant={variant} data-testid="admin-webhooks-readiness-badge">
            {data.status}
          </Badge>
          <span className="text-sm text-fg-muted" data-testid="admin-webhooks-readiness-text">
            {t(`feature.admin.webhooks.readiness.${data.status}`)}
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

function AddWebhookCard() {
  const t = useTranslation();
  const createWebhook = useCreateWebhook();
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<AddWebhookForm>({
    resolver: zodResolver(CreateWebhookSubscriptionRequestSchema),
    defaultValues: { url: "", eventTypes: [], enabled: true },
  });

  function onSubmit(values: AddWebhookForm) {
    createWebhook.mutate(
      {
        url: values.url,
        eventTypes: values.eventTypes as (typeof WEBHOOK_EVENT_TYPES)[number][],
        enabled: values.enabled,
      },
      {
        onSuccess: (result: CreateWebhookSubscriptionResponse) => {
          setRevealedSecret(result.secret);
          reset();
        },
      }
    );
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        <p className="text-sm font-medium text-fg">{t("feature.admin.webhooks.addHeading")}</p>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-3"
          data-testid="admin-webhooks-add-form"
        >
          <FormField
            label={t("feature.admin.webhooks.urlLabel")}
            placeholder={t("feature.admin.webhooks.urlPlaceholder")}
            isInvalid={!!errors.url}
            errorMessage={errors.url?.message}
            inputProps={{ "data-testid": "admin-webhooks-url-input", ...register("url") }}
          />

          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-medium text-fg">
              {t("feature.admin.webhooks.eventsLabel")}
            </legend>
            <Controller
              control={control}
              name="eventTypes"
              render={({ field }) => (
                <div className="space-y-1" data-testid="admin-webhooks-events">
                  {WEBHOOK_EVENT_TYPES.map((eventType) => (
                    <Checkbox
                      key={eventType}
                      isSelected={field.value.includes(eventType)}
                      onChange={(checked) => {
                        const next = checked
                          ? [...field.value, eventType]
                          : field.value.filter((e) => e !== eventType);
                        field.onChange(next);
                      }}
                      data-testid={`admin-webhooks-event-${eventType}`}
                    >
                      {eventType}
                    </Checkbox>
                  ))}
                </div>
              )}
            />
            {errors.eventTypes && (
              <p role="alert" className="text-sm text-danger">
                {errors.eventTypes.message}
              </p>
            )}
          </fieldset>

          <Controller
            control={control}
            name="enabled"
            render={({ field }) => (
              <Switch
                isSelected={field.value}
                onChange={field.onChange}
                data-testid="admin-webhooks-enabled"
              >
                {t("feature.admin.webhooks.enabledLabel")}
              </Switch>
            )}
          />

          {createWebhook.isError && (
            <p role="alert" className="text-sm text-danger" data-testid="admin-webhooks-add-error">
              {t("feature.admin.webhooks.addError")}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              type="submit"
              isDisabled={createWebhook.isPending}
              data-testid="admin-webhooks-add-button"
            >
              {t("feature.admin.webhooks.addButton")}
            </Button>
            <LiveRegion
              tone="polite"
              className="text-sm text-success"
              data-testid="admin-webhooks-added"
            >
              {createWebhook.isSuccess ? t("feature.admin.webhooks.added") : ""}
            </LiveRegion>
          </div>
        </form>

        {revealedSecret && (
          <SecretRevealPanel
            secret={revealedSecret}
            onDismiss={() => setRevealedSecret(null)}
            data-testid="admin-webhooks-secret-panel"
          />
        )}
      </CardBody>
    </Card>
  );
}

function SecretRevealPanel({
  secret,
  onDismiss,
  "data-testid": testId,
}: {
  secret: string;
  onDismiss: () => void;
  "data-testid"?: string;
}) {
  const t = useTranslation();
  return (
    <div
      className="rounded-md border border-border bg-surface-muted p-3 space-y-2"
      data-testid={testId ?? "admin-webhooks-secret-panel"}
    >
      <p className="text-sm font-medium text-fg">{t("feature.admin.webhooks.secretHeading")}</p>
      <p className="text-xs text-fg-muted">{t("feature.admin.webhooks.secretHelper")}</p>
      <code
        className="block break-all rounded bg-surface px-2 py-1 font-mono text-xs text-fg"
        data-testid="admin-webhooks-secret-value"
      >
        {secret}
      </code>
      <Button
        size="sm"
        variant="outline"
        type="button"
        onPress={onDismiss}
        data-testid="admin-webhooks-secret-done"
      >
        {t("feature.admin.webhooks.secretDone")}
      </Button>
    </div>
  );
}

function WebhookListCard({
  subscriptions,
  canWrite,
}: {
  subscriptions: WebhookSubscriptionSummary[];
  canWrite: boolean;
}) {
  const t = useTranslation();

  return (
    <Card>
      <CardBody>
        <p className="text-sm font-medium text-fg">{t("feature.admin.webhooks.listHeading")}</p>
        {subscriptions.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted" data-testid="admin-webhooks-empty">
            {t("feature.admin.webhooks.empty")}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm" data-testid="admin-webhooks-table">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold text-fg-muted">
                  <th className="pb-2 pr-4">{t("feature.admin.webhooks.columnUrl")}</th>
                  <th className="pb-2 pr-4">{t("feature.admin.webhooks.columnEvents")}</th>
                  <th className="pb-2 pr-4">{t("feature.admin.webhooks.columnEnabled")}</th>
                  <th className="pb-2 pr-4">{t("feature.admin.webhooks.columnSecret")}</th>
                  {canWrite && (
                    <th className="pb-2">{t("feature.admin.webhooks.recentChanges")}</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {subscriptions.map((sub) => (
                  <WebhookRow key={sub.id} subscription={sub} canWrite={canWrite} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function WebhookRow({
  subscription,
  canWrite,
}: {
  subscription: WebhookSubscriptionSummary;
  canWrite: boolean;
}) {
  const t = useTranslation();
  const rotate = useRotateSecret();
  const test = useTestWebhook();
  const remove = useDeleteWebhook();
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);
  const [showDeliveries, setShowDeliveries] = useState(false);

  return (
    <>
      <tr data-testid={`admin-webhooks-row-${subscription.id}`}>
        <td
          className="py-2 pr-4 font-mono text-xs max-w-[16rem] truncate"
          data-testid={`admin-webhooks-url-${subscription.id}`}
          title={subscription.url}
        >
          {subscription.url}
        </td>
        <td className="py-2 pr-4">
          <div
            className="flex flex-wrap gap-1"
            data-testid={`admin-webhooks-events-${subscription.id}`}
          >
            {subscription.eventTypes.map((et) => (
              <Badge key={et} variant="secondary" className="text-xs">
                {et}
              </Badge>
            ))}
          </div>
        </td>
        <td className="py-2 pr-4">
          <Badge
            variant={subscription.enabled ? "default" : "secondary"}
            data-testid={`admin-webhooks-enabled-${subscription.id}`}
          >
            {subscription.enabled ? "yes" : "no"}
          </Badge>
        </td>
        <td className="py-2 pr-4">
          <span
            className="text-xs text-fg-muted"
            data-testid={`admin-webhooks-secret-${subscription.id}`}
          >
            {t("feature.admin.webhooks.secretSet")}
          </span>
        </td>
        {canWrite && (
          <td className="py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                type="button"
                isDisabled={rotate.isPending}
                onPress={() =>
                  rotate.mutate(subscription.id, {
                    onSuccess: (res) => setRotatedSecret(res.secret),
                  })
                }
                data-testid={`admin-webhooks-rotate-${subscription.id}`}
              >
                {t("feature.admin.webhooks.rotateButton")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                type="button"
                isDisabled={test.isPending}
                onPress={() => test.mutate(subscription.id)}
                data-testid={`admin-webhooks-test-${subscription.id}`}
              >
                {t("feature.admin.webhooks.testButton")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                type="button"
                onPress={() => setShowDeliveries((v) => !v)}
                data-testid={`admin-webhooks-deliveries-toggle-${subscription.id}`}
              >
                {t("feature.admin.webhooks.deliveriesHeading")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                type="button"
                isDisabled={remove.isPending}
                onPress={() => remove.mutate(subscription.id)}
                data-testid={`admin-webhooks-remove-${subscription.id}`}
              >
                {t("feature.admin.webhooks.removeButton")}
              </Button>
            </div>

            {rotate.isError && (
              <p
                role="alert"
                className="mt-1 text-xs text-danger"
                data-testid={`admin-webhooks-rotate-error-${subscription.id}`}
              >
                {t("feature.admin.webhooks.rotateError")}
              </p>
            )}
            {test.isError && (
              <p
                role="alert"
                className="mt-1 text-xs text-danger"
                data-testid={`admin-webhooks-test-error-${subscription.id}`}
              >
                {t("feature.admin.webhooks.testError")}
              </p>
            )}

            <div className="mt-1 flex flex-wrap gap-2">
              <LiveRegion
                tone="polite"
                className="sr-only"
                data-testid={`admin-webhooks-rotated-announce-${subscription.id}`}
              >
                {rotate.isSuccess ? t("feature.admin.webhooks.rotated") : ""}
              </LiveRegion>
              <LiveRegion
                tone="polite"
                className="sr-only"
                data-testid={`admin-webhooks-tested-announce-${subscription.id}`}
              >
                {test.isSuccess
                  ? t("feature.admin.webhooks.tested") +
                    " " +
                    t(`feature.admin.webhooks.deliveryStatus.${test.data!.status}`)
                  : ""}
              </LiveRegion>
              <LiveRegion
                tone="polite"
                className="sr-only"
                data-testid={`admin-webhooks-removed-announce-${subscription.id}`}
              >
                {remove.isSuccess ? t("feature.admin.webhooks.removed") : ""}
              </LiveRegion>
            </div>
          </td>
        )}
      </tr>

      {rotatedSecret && (
        <tr>
          <td colSpan={canWrite ? 5 : 4} className="py-2">
            <SecretRevealPanel
              secret={rotatedSecret}
              onDismiss={() => setRotatedSecret(null)}
              data-testid={`admin-webhooks-rotated-secret-panel-${subscription.id}`}
            />
          </td>
        </tr>
      )}

      {showDeliveries && (
        <tr>
          <td colSpan={canWrite ? 5 : 4} className="py-2">
            <DeliveriesPanel id={subscription.id} canWrite={canWrite} />
          </td>
        </tr>
      )}
    </>
  );
}

function DeliveriesPanel({ id, canWrite }: Readonly<{ id: string; canWrite: boolean }>) {
  const t = useTranslation();
  const { data, isLoading } = useWebhookDeliveries(id);
  const { data: metrics, isLoading: metricsLoading } = useWebhookMetrics(id);
  const redriveDead = useRedriveDead(id);
  const [redriveDeadAnnounce, setRedriveDeadAnnounce] = useState("");

  if (isLoading || metricsLoading) return <LoadingState message={t("auth.status.loading")} />;

  const deliveries = data?.deliveries ?? [];

  function handleRedriveDead() {
    redriveDead.mutate(undefined, {
      onSuccess: () => setRedriveDeadAnnounce(t("feature.admin.webhooks.redrivenAll")),
      onError: () => setRedriveDeadAnnounce(t("feature.admin.webhooks.redriveError")),
    });
  }

  return (
    <div
      className="rounded-md border border-border bg-surface-muted p-3 space-y-2"
      data-testid={`admin-webhooks-deliveries-${id}`}
    >
      {metrics && (
        <div className="space-y-1" data-testid={`admin-webhooks-metrics-${id}`}>
          <p className="text-sm font-medium text-fg">
            {t("feature.admin.webhooks.metricsHeading")}
          </p>
          <div className="flex flex-wrap gap-3 text-xs text-fg-muted">
            <span>
              {t("feature.admin.webhooks.metric.total")}: <strong>{metrics.total}</strong>
            </span>
            <span>
              {t("feature.admin.webhooks.metric.delivered")}: <strong>{metrics.delivered}</strong>
            </span>
            <span>
              {t("feature.admin.webhooks.metric.failed")}: <strong>{metrics.failed}</strong>
            </span>
            <span>
              {t("feature.admin.webhooks.metric.dead")}: <strong>{metrics.dead}</strong>
            </span>
            <span>
              {t("feature.admin.webhooks.metric.pending")}: <strong>{metrics.pending}</strong>
            </span>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-fg-muted">
            <span>
              {t("feature.admin.webhooks.lastDeliveryLabel")}:{" "}
              {metrics.lastDeliveryAt ?? t("feature.admin.webhooks.never")}
            </span>
            <span>
              {t("feature.admin.webhooks.lastSuccessLabel")}:{" "}
              {metrics.lastSuccessAt ?? t("feature.admin.webhooks.never")}
            </span>
            <span>
              {t("feature.admin.webhooks.lastFailureLabel")}:{" "}
              {metrics.lastFailureAt ?? t("feature.admin.webhooks.never")}
            </span>
          </div>
          {canWrite && metrics.dead > 0 && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                type="button"
                isDisabled={redriveDead.isPending}
                onPress={handleRedriveDead}
                data-testid={`admin-webhooks-redrive-all-${id}`}
              >
                {t("feature.admin.webhooks.redriveAllButton")}
              </Button>
              <LiveRegion
                tone="polite"
                className="sr-only"
                data-testid={`admin-webhooks-redrive-all-announce-${id}`}
              >
                {redriveDeadAnnounce}
              </LiveRegion>
            </div>
          )}
        </div>
      )}

      <p className="text-sm font-medium text-fg">{t("feature.admin.webhooks.deliveriesHeading")}</p>
      {deliveries.length === 0 ? (
        <p className="text-sm text-fg-muted" data-testid={`admin-webhooks-deliveries-empty-${id}`}>
          {t("feature.admin.webhooks.noDeliveries")}
        </p>
      ) : (
        <table className="w-full text-xs" data-testid={`admin-webhooks-deliveries-table-${id}`}>
          <thead>
            <tr className="border-b border-border text-left font-semibold text-fg-muted">
              <th className="pb-1 pr-4">Event</th>
              <th className="pb-1 pr-4">Status</th>
              <th className="pb-1 pr-4">HTTP</th>
              {canWrite && <th className="pb-1" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {deliveries.map((d) => (
              <DeliveryRow key={d.id} delivery={d} subscriptionId={id} canWrite={canWrite} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DeliveryRow({
  delivery,
  subscriptionId,
  canWrite,
}: {
  delivery: WebhookDeliverySummary;
  subscriptionId: string;
  canWrite: boolean;
}) {
  const t = useTranslation();
  const redriveDelivery = useRedriveDelivery(subscriptionId);
  const [announce, setAnnounce] = useState("");

  const variant = delivery.status === "delivered" ? "default" : "secondary";

  function handleRedrive() {
    redriveDelivery.mutate(delivery.id, {
      onSuccess: () => setAnnounce(t("feature.admin.webhooks.redriven")),
      onError: () => setAnnounce(t("feature.admin.webhooks.redriveError")),
    });
  }

  return (
    <tr>
      <td className="py-1 pr-4 font-mono">{delivery.event}</td>
      <td className="py-1 pr-4">
        <Badge variant={variant}>
          {t(`feature.admin.webhooks.deliveryStatus.${delivery.status}`)}
        </Badge>
      </td>
      <td className="py-1 pr-4 text-fg-muted">{delivery.responseStatus ?? "—"}</td>
      {canWrite && (
        <td className="py-1">
          {delivery.status === "dead" && (
            <>
              <Button
                size="sm"
                variant="outline"
                type="button"
                isDisabled={redriveDelivery.isPending}
                onPress={handleRedrive}
                data-testid={`admin-webhooks-redrive-${delivery.id}`}
              >
                {t("feature.admin.webhooks.redriveButton")}
              </Button>
              <LiveRegion
                tone="polite"
                className="sr-only"
                data-testid={`admin-webhooks-redrive-announce-${delivery.id}`}
              >
                {announce}
              </LiveRegion>
            </>
          )}
        </td>
      )}
    </tr>
  );
}
