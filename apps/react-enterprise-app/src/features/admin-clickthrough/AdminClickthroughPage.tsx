import { Card, CardBody, Badge, LoadingState, LiveRegion } from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import { AdminQueryError } from "../admin/AdminQueryError";
import { useClickthroughServices } from "./use-admin-clickthrough";
import type {
  ClickthroughServiceRow,
  ComposedProviderReadinessRow,
} from "./admin-clickthrough-client";

type Translate = (key: string) => string;

const READINESS_TONE: Record<string, "default" | "secondary"> = {
  ready: "default",
  degraded: "secondary",
  not_configured: "secondary",
  unknown: "secondary",
};

/**
 * Click-through services (ADR-ACT-0233 / ADR-0072). Read-only operator view of the
 * composed Compose GUI services: where you can click through, whether your session is
 * permitted, and the OpenBao-credential-validated composed-provider readiness. Console
 * links are localhost-safe apex paths supplied by the BFF; no secret is shown here.
 */
export function AdminClickthroughPage() {
  const t = useTranslation() as Translate;
  const { data, isLoading, isError, error, refetch } = useClickthroughServices();

  if (isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (isError) return <AdminQueryError error={error} onRetry={() => void refetch()} />;

  const { services, providers } = data!;

  return (
    <div className="space-y-6" data-testid="admin-clickthrough">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-fg">{t("feature.admin.clickthrough.title")}</h1>
        <p className="text-sm text-fg-muted">{t("feature.admin.clickthrough.description")}</p>
      </header>

      <Card>
        <CardBody className="space-y-4">
          <p className="text-sm font-medium text-fg">
            {t("feature.admin.clickthrough.servicesTitle")}
          </p>
          <ul className="space-y-3">
            {services.map((service) => (
              <ClickthroughRow key={service.id} service={service} t={t} />
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-4">
          <p className="text-sm font-medium text-fg">
            {t("feature.admin.clickthrough.readinessTitle")}
          </p>
          {providers.length === 0 ? (
            <p className="text-sm text-fg-muted">{t("feature.admin.clickthrough.noProviders")}</p>
          ) : (
            <ul className="space-y-2">
              {providers.map((provider) => (
                <ProviderRow
                  key={`${provider.provider}:${provider.capability}`}
                  provider={provider}
                  t={t}
                />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <LiveRegion tone="polite" className="sr-only" />
    </div>
  );
}

function ClickthroughRow({ service, t }: { service: ClickthroughServiceRow; t: Translate }) {
  return (
    <li
      className="flex flex-col gap-1 border-b border-border pb-3 last:border-0 last:pb-0"
      data-testid={`admin-clickthrough-service-${service.id}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium text-fg">{service.id}</span>
        <Badge variant="secondary">
          {t(`feature.admin.clickthrough.classification.${service.classification}`)}
        </Badge>
        <Badge variant={READINESS_TONE[service.readiness] ?? "secondary"}>
          {t(`feature.admin.clickthrough.readiness.${service.readiness}`)}
        </Badge>
        {service.accessible && service.url ? (
          <a
            href={service.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-primary underline"
            data-testid={`admin-clickthrough-open-${service.id}`}
          >
            {t("feature.admin.clickthrough.open")}
          </a>
        ) : (
          <span className="text-sm text-fg-muted">{t("feature.admin.clickthrough.locked")}</span>
        )}
      </div>
      <p className="text-xs text-fg-muted">{service.isolationInvariant}</p>
    </li>
  );
}

function ProviderRow({ provider, t }: { provider: ComposedProviderReadinessRow; t: Translate }) {
  return (
    <li
      className="flex flex-wrap items-center gap-3"
      data-testid={`admin-clickthrough-provider-${provider.provider}`}
    >
      <span className="font-medium text-fg">{provider.provider}</span>
      <span className="text-sm text-fg-muted">{provider.capability}</span>
      <Badge variant={provider.status === "ready" ? "default" : "secondary"}>
        {t(`feature.admin.clickthrough.readiness.${provider.status}`)}
      </Badge>
      <span className="text-xs text-fg-muted">{provider.detail}</span>
    </li>
  );
}
