import { Card, CardBody, Badge, LoadingState, LiveRegion } from "@platform/ui-design-system";
import { PROOF_LADDER } from "@platform/contracts-admin";
import { useTranslation } from "@platform/i18n-runtime";
import { AdminQueryError } from "../admin/AdminQueryError";
import { useSession } from "../../hooks/use-session";
import { usePlatformServicesReadiness } from "./use-admin-platform";
import type { PlatformServiceSummary, PlatformWorkerSummary } from "./admin-platform-client";

type Translate = (key: string) => string;

/**
 * Platform Operations Cockpit (ADR-0036). Read-only operator view of local
 * service health, background workers, and a static proof-ladder index. The data
 * comes straight from the BFF; console links are localhost-safe URLs supplied by
 * the API. Nothing here is a production readiness signal.
 */
export function AdminPlatformPage() {
  const t = useTranslation();
  const { actor } = useSession();
  const { data, isLoading, isError, error, refetch } = usePlatformServicesReadiness();

  if (isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (isError) return <AdminQueryError error={error} onRetry={() => void refetch()} />;

  const readiness = data!;
  const roles = actor?.roles ?? [];

  return (
    <div className="space-y-6" data-testid="admin-platform">
      <header className="space-y-3">
        <div>
          <h1 className="text-lg font-semibold text-fg">{t("feature.admin.platform.title")}</h1>
          <p className="text-sm text-fg-muted">{t("feature.admin.platform.description")}</p>
        </div>

        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <SummaryItem
            label={t("feature.admin.platform.environmentLabel")}
            value={readiness.environment}
            testId="admin-platform-environment"
          />
          <SummaryItem
            label={t("feature.admin.platform.versionLabel")}
            value={readiness.appVersion ?? t("feature.admin.platform.unknownVersion")}
            testId="admin-platform-version"
          />
          <SummaryItem
            label={t("feature.admin.platform.tenantLabel")}
            value={actor?.tenantId ?? "-"}
            testId="admin-platform-tenant"
          />
          <SummaryItem
            label={t("feature.admin.platform.roleLabel")}
            value={roles.length > 0 ? roles.join(", ") : "-"}
            testId="admin-platform-roles"
          />
        </dl>
      </header>

      {/* Services */}
      <Card>
        <CardBody className="space-y-4">
          <p className="text-sm font-medium text-fg">
            {t("feature.admin.platform.servicesHeading")}
          </p>
          <ul className="space-y-2">
            {readiness.services.map((service) => (
              <ServiceRow key={service.key} service={service} t={t} />
            ))}
          </ul>
        </CardBody>
      </Card>

      {/* Workers */}
      <Card>
        <CardBody className="space-y-4">
          <p className="text-sm font-medium text-fg">
            {t("feature.admin.platform.workersHeading")}
          </p>
          <ul className="space-y-2">
            {readiness.workers.map((worker) => (
              <WorkerRow key={worker.key} worker={worker} t={t} />
            ))}
          </ul>
        </CardBody>
      </Card>

      {/* Proof ladder (static documentation index — never executed). */}
      <Card>
        <CardBody className="space-y-4">
          <p className="text-sm font-medium text-fg">{t("feature.admin.platform.proofsHeading")}</p>
          <p className="text-sm text-fg-muted">{t("feature.admin.platform.proofNote")}</p>
          <ul className="flex flex-wrap gap-2" data-testid="admin-platform-proofs">
            {PROOF_LADDER.map((proof) => (
              <li key={proof} className="flex items-center gap-2">
                <code className="rounded bg-surface-muted px-2 py-0.5 text-xs text-fg">
                  {proof}
                </code>
                <Badge variant="secondary">{t("feature.admin.platform.localOnly")}</Badge>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {/* LiveRegion present for axe compliance; no mutations, so always empty. */}
      <LiveRegion tone="polite" className="sr-only" />
    </div>
  );
}

function SummaryItem({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="font-medium text-fg">{label}:</dt>
      <dd className="text-fg-muted" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function ServiceRow({ service, t }: { service: PlatformServiceSummary; t: Translate }) {
  return (
    <li
      className="flex flex-wrap items-center gap-3"
      data-testid={`admin-platform-service-${service.key}`}
    >
      <span className="font-medium text-fg">{t(service.labelKey)}</span>
      <Badge variant={service.status === "healthy" ? "default" : "secondary"}>
        {t(`feature.admin.platform.status.${service.status}`)}
      </Badge>
      <Badge variant="outline">{t(`feature.admin.platform.category.${service.category}`)}</Badge>
      {service.localOnly ? (
        <Badge variant="secondary">{t("feature.admin.platform.localOnly")}</Badge>
      ) : null}
      {service.detailKey ? (
        <span className="text-sm text-fg-muted">{t(service.detailKey)}</span>
      ) : null}
      {service.consoleUrl ? (
        <>
          <a
            href={service.consoleUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t("feature.admin.platform.openConsole")}
          </a>
          {/* Routed-vs-direct labelling (ADR-ACT-0236): a direct local port is
              never presented unlabelled as if it were tenant-routed. */}
          {service.consoleUrlKind ? (
            <Badge variant="outline">
              {t(`feature.admin.platform.linkKind.${service.consoleUrlKind}`)}
            </Badge>
          ) : null}
        </>
      ) : service.consoleAccess === "global_only" ? (
        // The BFF withholds global-only console links from non-system-admin viewers.
        <span className="text-sm text-fg-muted">
          {t("feature.admin.platform.systemOperatorOnly")}
        </span>
      ) : null}
    </li>
  );
}

function WorkerRow({ worker, t }: { worker: PlatformWorkerSummary; t: Translate }) {
  return (
    <li
      className="flex flex-wrap items-center gap-3"
      data-testid={`admin-platform-worker-${worker.key}`}
    >
      <span className="font-medium text-fg">{t(worker.labelKey)}</span>
      <Badge variant={worker.status === "running" ? "default" : "secondary"}>
        {t(`feature.admin.platform.workerStatus.${worker.status}`)}
      </Badge>
      <span className="text-sm text-fg-muted">
        {t("feature.admin.platform.intervalLabel")}: {worker.intervalMs}
      </span>
      <span className="text-sm text-fg-muted">
        {t("feature.admin.platform.lastTickLabel")}:{" "}
        {worker.lastTickAt ?? t("feature.admin.platform.never")}
      </span>
      {worker.inMemory ? (
        <span className="text-sm text-fg-muted">{t("feature.admin.platform.inMemoryNote")}</span>
      ) : null}
    </li>
  );
}
