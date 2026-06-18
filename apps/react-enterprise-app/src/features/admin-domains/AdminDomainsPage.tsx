import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Card,
  CardBody,
  Badge,
  Button,
  FormField,
  LoadingState,
  LiveRegion,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import {
  CreateTenantDomainRequestSchema,
  type TenantDomainSummary,
  type TenantDomainStatus,
  type TenantDomainReadinessStatus,
} from "@platform/contracts-admin";
import { useSession } from "../../hooks/use-session";
import { AdminQueryError } from "../admin/AdminQueryError";
import {
  useDomains,
  useDomainsReadiness,
  useAddDomain,
  useVerifyDomain,
  useRemoveDomain,
  useActivateDomain,
  useDeactivateDomain,
  useProbeDomainRoutingLocal,
  useSetCanonicalDomain,
  useUnsetCanonicalDomain,
} from "./use-admin-domains";
import type { TenantDomainVerificationResponse } from "./admin-domains-client";

interface AddDomainForm {
  domain: string;
}

type StatusTone = "success" | "warning" | "secondary";

/** Maps a domain/readiness status to its banner/badge tone. */
function statusToTone(status: TenantDomainStatus | TenantDomainReadinessStatus): StatusTone {
  if (status === "verified") return "success";
  if (status === "degraded") return "warning";
  return "secondary";
}

/** Picks the announce label for the most recent successful lifecycle action. */
function lifecycleAnnounceLabel(
  t: (k: string) => string,
  state: Readonly<{
    activated: boolean;
    deactivated: boolean;
    probed: boolean;
    probeMatched: boolean;
    canonicalSet: boolean;
    canonicalUnset: boolean;
  }>
): string {
  if (state.activated) return t("feature.admin.domains.activated");
  if (state.deactivated) return t("feature.admin.domains.deactivated");
  if (state.probed) {
    return state.probeMatched
      ? t("feature.admin.domains.probeMatched")
      : t("feature.admin.domains.probeUnmatched");
  }
  if (state.canonicalSet) return t("feature.admin.domains.canonicalSet");
  if (state.canonicalUnset) return t("feature.admin.domains.canonicalUnset");
  return "";
}

/**
 * Tenant custom domains management page (ADR-0048). Read-only unless the actor
 * holds `tenant.domains.write`. The DNS TXT token is a public DNS value and is
 * safe to display.
 */
export function AdminDomainsPage() {
  const t = useTranslation();
  const { hasPermission } = useSession();
  const canWrite = hasPermission("tenant.domains.write");
  const { data, isLoading, isError, error, refetch } = useDomains();

  if (isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (isError) return <AdminQueryError error={error} onRetry={() => void refetch()} />;

  return (
    <div className="space-y-6" data-testid="admin-domains">
      <header>
        <h1 className="text-lg font-semibold text-fg">{t("feature.admin.domains.title")}</h1>
        <p className="text-sm text-fg-muted">{t("feature.admin.domains.description")}</p>
      </header>

      <ReadinessBanner />
      {canWrite && <AddDomainCard />}
      <DomainListCard domains={data!.domains} canWrite={canWrite} />
    </div>
  );
}

function ReadinessBanner() {
  const t = useTranslation();
  const { data, isLoading } = useDomainsReadiness();

  if (isLoading || !data) return null;

  const tone = statusToTone(data.status);

  return (
    <Card>
      <CardBody>
        <p className="text-sm font-medium text-fg">{t("feature.admin.domains.readinessHeading")}</p>
        <div className="mt-1 flex items-center gap-2">
          <Badge
            variant={tone === "success" ? "default" : "secondary"}
            data-testid="admin-domains-readiness-badge"
          >
            {data.status}
          </Badge>
          <span className="text-sm text-fg-muted" data-testid="admin-domains-readiness-text">
            {t(`feature.admin.domains.readiness.${data.status}`)}
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

function AddDomainCard() {
  const t = useTranslation();
  const addDomain = useAddDomain();
  const [pendingRecord, setPendingRecord] = useState<TenantDomainVerificationResponse | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddDomainForm>({
    resolver: zodResolver(CreateTenantDomainRequestSchema),
  });

  function onSubmit(values: AddDomainForm) {
    addDomain.mutate(
      { domain: values.domain },
      {
        onSuccess: (result) => {
          setPendingRecord(result);
          reset();
        },
      }
    );
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        <p className="text-sm font-medium text-fg">{t("feature.admin.domains.addHeading")}</p>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-3"
          data-testid="admin-domains-add-form"
        >
          <FormField
            label={t("feature.admin.domains.domainLabel")}
            placeholder={t("feature.admin.domains.domainPlaceholder")}
            isInvalid={!!errors.domain}
            errorMessage={errors.domain?.message}
            inputProps={{ "data-testid": "admin-domains-domain-input", ...register("domain") }}
          />
          {addDomain.isError && (
            <p role="alert" className="text-sm text-danger" data-testid="admin-domains-add-error">
              {(addDomain.error as { code?: string }).code === "DOMAIN_ALREADY_CLAIMED"
                ? t("feature.admin.domains.addConflictError")
                : t("feature.admin.domains.addError")}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              type="submit"
              isDisabled={addDomain.isPending}
              data-testid="admin-domains-add-button"
            >
              {t("feature.admin.domains.addButton")}
            </Button>
            <LiveRegion
              tone="polite"
              className="text-sm text-success"
              data-testid="admin-domains-added"
            >
              {addDomain.isSuccess ? t("feature.admin.domains.added") : ""}
            </LiveRegion>
          </div>
        </form>

        {pendingRecord && <TxtRecordPanel record={pendingRecord} />}
      </CardBody>
    </Card>
  );
}

function TxtRecordPanel({ record }: Readonly<{ record: TenantDomainVerificationResponse }>) {
  const t = useTranslation();
  return (
    <div
      className="rounded-md border border-border bg-surface-muted p-3 space-y-2"
      data-testid="admin-domains-txt-panel"
    >
      <p className="text-sm font-medium text-fg">{t("feature.admin.domains.txtHeading")}</p>
      <p className="text-xs text-fg-muted">{t("feature.admin.domains.txtHelper")}</p>
      <dl className="space-y-1 text-xs">
        <div className="flex gap-2">
          <dt className="font-medium text-fg">{t("feature.admin.domains.txtName")}:</dt>
          <dd className="font-mono text-fg-muted" data-testid="admin-domains-txt-name">
            {record.txtRecord}
          </dd>
        </div>
        {record.token && (
          <div className="flex gap-2">
            <dt className="font-medium text-fg">{t("feature.admin.domains.txtValue")}:</dt>
            <dd className="font-mono text-fg-muted" data-testid="admin-domains-txt-value">
              {record.token}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function DomainListCard({
  domains,
  canWrite,
}: Readonly<{
  domains: TenantDomainSummary[];
  canWrite: boolean;
}>) {
  const t = useTranslation();

  return (
    <Card>
      <CardBody>
        <p className="text-sm font-medium text-fg">{t("feature.admin.domains.listHeading")}</p>
        {domains.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted" data-testid="admin-domains-empty">
            {t("feature.admin.domains.empty")}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm" data-testid="admin-domains-table">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold text-fg-muted">
                  <th className="pb-2 pr-4">{t("feature.admin.domains.columnDomain")}</th>
                  <th className="pb-2 pr-4">{t("feature.admin.domains.columnStatus")}</th>
                  <th className="pb-2 pr-4">{t("feature.admin.domains.columnAuthClient")}</th>
                  <th className="pb-2 pr-4">{t("feature.admin.domains.columnRouting")}</th>
                  <th className="pb-2 pr-4">{t("feature.admin.domains.columnTls")}</th>
                  <th className="pb-2 pr-4">{t("feature.admin.domains.columnCanonical")}</th>
                  {canWrite && <th className="pb-2">{t("feature.admin.domains.recentChanges")}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {domains.map((d) => (
                  <DomainRow key={d.domain} domain={d} canWrite={canWrite} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function DomainRow({
  domain,
  canWrite,
}: Readonly<{ domain: TenantDomainSummary; canWrite: boolean }>) {
  const t = useTranslation();
  const verify = useVerifyDomain();
  const remove = useRemoveDomain();
  const activate = useActivateDomain();
  const deactivate = useDeactivateDomain();
  const probe = useProbeDomainRoutingLocal();
  const setCanonical = useSetCanonicalDomain();
  const unsetCanonical = useUnsetCanonicalDomain();

  const statusTone = statusToTone(domain.status);

  // Action availability mirrors the server-side guards (ADR-ACT-0232) so the
  // UI never offers an operation the BFF would reject. Unsupported actions are
  // hidden, not disabled.
  const canVerify = domain.status !== "verified";
  const canActivate = domain.status === "verified" && domain.authClient === "inactive";
  const canDeactivate = domain.authClient === "active";
  const canProbe = domain.authClient === "active";
  const canMakeCanonical =
    domain.status === "verified" &&
    domain.authClient === "active" &&
    domain.routing !== "routing_unknown" &&
    !domain.canonical;

  const anyPending =
    verify.isPending ||
    remove.isPending ||
    activate.isPending ||
    deactivate.isPending ||
    probe.isPending ||
    setCanonical.isPending ||
    unsetCanonical.isPending;

  return (
    <tr data-testid={`admin-domains-row-${domain.domain}`}>
      <td
        className="py-2 pr-4 font-mono text-xs"
        data-testid={`admin-domains-domain-${domain.domain}`}
      >
        {domain.domain}
      </td>
      <td className="py-2 pr-4">
        <Badge variant={statusTone === "success" ? "default" : "secondary"}>
          {t(`feature.admin.domains.status.${domain.status}`)}
        </Badge>
      </td>
      <td className="py-2 pr-4">
        <Badge
          variant={domain.authClient === "active" ? "default" : "secondary"}
          data-testid={`admin-domains-authclient-${domain.domain}`}
        >
          {t(`feature.admin.domains.authClient.${domain.authClient}`)}
        </Badge>
      </td>
      <td className="py-2 pr-4">
        <Badge variant="secondary" data-testid={`admin-domains-routing-${domain.domain}`}>
          {t(`feature.admin.domains.routing.${domain.routing}`)}
        </Badge>
      </td>
      <td className="py-2 pr-4">
        <Badge variant="secondary">{t(`feature.admin.domains.tls.${domain.tls}`)}</Badge>
      </td>
      <td className="py-2 pr-4" data-testid={`admin-domains-canonical-${domain.domain}`}>
        {domain.canonical ? (
          <div className="space-y-1">
            <Badge variant="default">{t("feature.admin.domains.canonicalBadge")}</Badge>
            {/* Canonical is a marker only — make the no-redirect truth unmissable. */}
            <p
              className="text-xs text-fg-muted"
              data-testid={`admin-domains-canonical-note-${domain.domain}`}
            >
              {t("feature.admin.domains.canonicalNoRedirect")}
            </p>
          </div>
        ) : (
          <span className="text-xs text-fg-muted">—</span>
        )}
      </td>
      {canWrite && (
        <td className="py-2">
          <div className="flex flex-wrap items-center gap-2">
            {canVerify && (
              <Button
                size="sm"
                variant="outline"
                type="button"
                isDisabled={anyPending}
                onPress={() => verify.mutate(domain.domain)}
                data-testid={`admin-domains-verify-${domain.domain}`}
              >
                {t("feature.admin.domains.verifyButton")}
              </Button>
            )}
            {canActivate && (
              <Button
                size="sm"
                variant="outline"
                type="button"
                isDisabled={anyPending}
                onPress={() => activate.mutate(domain.domain)}
                data-testid={`admin-domains-activate-${domain.domain}`}
              >
                {t("feature.admin.domains.activateButton")}
              </Button>
            )}
            {canProbe && (
              <Button
                size="sm"
                variant="outline"
                type="button"
                isDisabled={anyPending}
                onPress={() => probe.mutate(domain.domain)}
                data-testid={`admin-domains-probe-${domain.domain}`}
              >
                {t("feature.admin.domains.probeButton")}
              </Button>
            )}
            {canMakeCanonical && (
              <Button
                size="sm"
                variant="outline"
                type="button"
                isDisabled={anyPending}
                onPress={() => setCanonical.mutate(domain.domain)}
                data-testid={`admin-domains-set-canonical-${domain.domain}`}
              >
                {t("feature.admin.domains.setCanonicalButton")}
              </Button>
            )}
            {domain.canonical && (
              <Button
                size="sm"
                variant="outline"
                type="button"
                isDisabled={anyPending}
                onPress={() => unsetCanonical.mutate(domain.domain)}
                data-testid={`admin-domains-unset-canonical-${domain.domain}`}
              >
                {t("feature.admin.domains.unsetCanonicalButton")}
              </Button>
            )}
            {canDeactivate && (
              <Button
                size="sm"
                variant="outline"
                type="button"
                isDisabled={anyPending}
                onPress={() => deactivate.mutate(domain.domain)}
                data-testid={`admin-domains-deactivate-${domain.domain}`}
              >
                {t("feature.admin.domains.deactivateButton")}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              type="button"
              isDisabled={anyPending}
              onPress={() => remove.mutate(domain.domain)}
              data-testid={`admin-domains-remove-${domain.domain}`}
            >
              {t("feature.admin.domains.removeButton")}
            </Button>
            <LiveRegion
              tone="polite"
              className="sr-only"
              data-testid={`admin-domains-verify-announce-${domain.domain}`}
            >
              {verify.isSuccess ? t("feature.admin.domains.verifyButton") : ""}
            </LiveRegion>
            <LiveRegion
              tone="polite"
              className="sr-only"
              data-testid={`admin-domains-lifecycle-announce-${domain.domain}`}
            >
              {lifecycleAnnounceLabel(t, {
                activated: activate.isSuccess,
                deactivated: deactivate.isSuccess,
                probed: probe.isSuccess,
                probeMatched: probe.data?.tenantContextMatched ?? false,
                canonicalSet: setCanonical.isSuccess,
                canonicalUnset: unsetCanonical.isSuccess,
              })}
            </LiveRegion>
            <LiveRegion
              tone="polite"
              className="sr-only"
              data-testid={`admin-domains-remove-announce-${domain.domain}`}
            >
              {remove.isSuccess ? t("feature.admin.domains.removed") : ""}
            </LiveRegion>
          </div>
          {domain.canonical && (
            <p className="mt-1 text-xs text-fg-muted">
              {t("feature.admin.domains.canonicalLocalNote")}
            </p>
          )}
          {verify.isError && (
            <p
              role="alert"
              className="mt-1 text-xs text-danger"
              data-testid={`admin-domains-verify-error-${domain.domain}`}
            >
              {t("feature.admin.domains.verifyError")}
            </p>
          )}
          {activate.isError && (
            <p
              role="alert"
              className="mt-1 text-xs text-danger"
              data-testid={`admin-domains-activate-error-${domain.domain}`}
            >
              {t("feature.admin.domains.activateError")}
            </p>
          )}
          {setCanonical.isError && (
            <p
              role="alert"
              className="mt-1 text-xs text-danger"
              data-testid={`admin-domains-set-canonical-error-${domain.domain}`}
            >
              {t("feature.admin.domains.setCanonicalError")}
            </p>
          )}
        </td>
      )}
    </tr>
  );
}
