import { useMemo } from "react";
import {
  Card,
  CardBody,
  Tabs,
  type TabItem,
  Select,
  type SelectItem,
  Switch,
  Badge,
  LoadingState,
  EmptyState,
  LiveRegion,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import { PRODUCT_PROVIDER_IDS, type ProductProviderId } from "@platform/contracts-admin";
import { useSession } from "../../hooks/use-session";
import { AdminSectionHeader } from "../../components/AdminLayout";
import {
  useAuthProviders,
  useSetAuthProviders,
  useIdps,
  useMfaPolicy,
  useSessionPolicy,
} from "./use-admin-auth";

const MODE_OPTIONS = ["default", "mock", "real", "disabled"] as const;

/**
 * Authentication section (ADR-0036 / ADR-0037). Tenant admins manage their login
 * options here. The Providers tab is per-tenant provider config (mode + which
 * third-party logins are offered) — priority-6 of the control plane. The other
 * tabs surface the realm's identity providers, MFA policy, and session policy.
 */
export function AdminAuthPage() {
  const t = useTranslation();
  const { hasPermission } = useSession();
  const canWrite = hasPermission("tenant.auth.settings.write");

  const tabs: TabItem[] = useMemo(
    () => [
      {
        id: "providers",
        label: t("feature.admin.auth.tab.providers"),
        content: <ProvidersTab canWrite={canWrite} />,
      },
      { id: "idps", label: t("feature.admin.auth.tab.idps"), content: <IdpsTab /> },
      { id: "mfa", label: t("feature.admin.auth.tab.mfa"), content: <MfaTab /> },
      { id: "session", label: t("feature.admin.auth.tab.session"), content: <SessionTab /> },
    ],
    [t, canWrite]
  );

  return (
    <section data-testid="admin-auth">
      <AdminSectionHeader
        heading={t("feature.admin.auth.title")}
        description={t("feature.admin.auth.description")}
      />
      <Tabs tabs={tabs} aria-label={t("feature.admin.auth.title")} />
    </section>
  );
}

function ProvidersTab({ canWrite }: { canWrite: boolean }) {
  const t = useTranslation();
  const { data, isLoading, isError } = useAuthProviders();
  const mutation = useSetAuthProviders();

  const modeItems: SelectItem[] = MODE_OPTIONS.map((m) => ({
    id: m,
    label:
      m === "default"
        ? t("feature.admin.auth.providers.mode.default", {
            mode: data ? t(`feature.admin.auth.providers.mode.${data.environmentDefaultMode}`) : "",
          })
        : t(`feature.admin.auth.providers.mode.${m}`),
  }));

  if (isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (isError || !data) return <EmptyState title={t("feature.admin.auth.providers.unavailable")} />;

  const enabled = new Set(data.config.enabledProviders);
  // Available third-party providers (platform is always on, never a toggle).
  const toggleable = data.availableProviders.filter(
    (id): id is ProductProviderId => PRODUCT_PROVIDER_IDS.includes(id) && id !== "platform"
  );

  function setEnabled(id: ProductProviderId, on: boolean) {
    const next = new Set(enabled);
    if (on) next.add(id);
    else next.delete(id);
    mutation.mutate({ enabledProviders: [...next] });
  }

  return (
    <Card>
      <CardBody className="space-y-6">
        <div className="max-w-xs">
          <label className="mb-1 block text-sm font-medium text-fg" id="auth-mode-label">
            {t("feature.admin.auth.providers.modeLabel")}
          </label>
          <Select
            items={modeItems}
            placeholder={t("feature.admin.auth.providers.modeLabel")}
            selectedKey={data.config.mode}
            isDisabled={!canWrite || mutation.isPending}
            aria-labelledby="auth-mode-label"
            onSelectionChange={(key) =>
              mutation.mutate({ mode: key as (typeof MODE_OPTIONS)[number] })
            }
            data-testid="auth-provider-mode"
          />
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-fg">
            {t("feature.admin.auth.providers.enabledLabel")}
          </legend>
          {toggleable.length === 0 ? (
            <p className="text-sm text-fg-muted">
              {t("feature.admin.auth.providers.noneAvailable")}
            </p>
          ) : (
            toggleable.map((id) => (
              <Switch
                key={id}
                isSelected={enabled.has(id)}
                isDisabled={!canWrite || mutation.isPending}
                onChange={(on) => setEnabled(id, on)}
                data-testid={`auth-provider-${id}`}
              >
                {t(`feature.admin.auth.providers.name.${id}`)}
              </Switch>
            ))
          )}
        </fieldset>

        <LiveRegion
          tone="polite"
          className="text-sm text-success"
          data-testid="auth-providers-status"
        >
          {mutation.isSuccess ? t("feature.admin.auth.providers.saved") : ""}
        </LiveRegion>
      </CardBody>
    </Card>
  );
}

/** Shared graceful wrapper for the read-only realm tabs: a missing per-tenant
 * service-account credential (503) shows an informational, not error, state. */
function ReadTab({
  isLoading,
  isError,
  hasData,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  hasData: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslation();
  if (isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (isError || !hasData) return <EmptyState title={t("feature.admin.auth.notConfigured")} />;
  return <>{children}</>;
}

function IdpsTab() {
  const t = useTranslation();
  const { data, isLoading, isError } = useIdps();
  return (
    <ReadTab isLoading={isLoading} isError={isError} hasData={!!data}>
      {data && data.length === 0 ? (
        <EmptyState title={t("feature.admin.auth.idps.empty")} />
      ) : (
        <Card>
          <CardBody className="divide-y divide-border" data-testid="auth-idps-list">
            {(data ?? []).map((idp) => (
              <div
                key={idp.alias}
                className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div>
                  <p className="text-sm font-medium text-fg">{idp.displayName}</p>
                  <p className="text-xs text-fg-muted">
                    {idp.alias} · {idp.providerId}
                  </p>
                </div>
                <Badge variant={idp.enabled ? "default" : "secondary"}>
                  {idp.enabled
                    ? t("feature.admin.auth.idps.enabled")
                    : t("feature.admin.auth.idps.disabled")}
                </Badge>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </ReadTab>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="font-medium text-fg">{value}</span>
    </div>
  );
}

function MfaTab() {
  const t = useTranslation();
  const { data, isLoading, isError } = useMfaPolicy();
  return (
    <ReadTab isLoading={isLoading} isError={isError} hasData={!!data}>
      <Card>
        <CardBody className="divide-y divide-border" data-testid="auth-mfa">
          <Detail label={t("feature.admin.auth.mfa.required")} value={data?.required ?? ""} />
          <Detail label={t("feature.admin.auth.mfa.type")} value={data?.type ?? ""} />
        </CardBody>
      </Card>
    </ReadTab>
  );
}

function SessionTab() {
  const t = useTranslation();
  const { data, isLoading, isError } = useSessionPolicy();
  return (
    <ReadTab isLoading={isLoading} isError={isError} hasData={!!data}>
      <Card>
        <CardBody className="divide-y divide-border" data-testid="auth-session">
          <Detail
            label={t("feature.admin.auth.session.accessTokenLifespan")}
            value={`${data?.accessTokenLifespanSeconds ?? 0}s`}
          />
          <Detail
            label={t("feature.admin.auth.session.idleTimeout")}
            value={`${data?.ssoSessionIdleTimeoutSeconds ?? 0}s`}
          />
          <Detail
            label={t("feature.admin.auth.session.maxLifespan")}
            value={`${data?.ssoSessionMaxLifespanSeconds ?? 0}s`}
          />
          <Detail
            label={t("feature.admin.auth.session.rememberMe")}
            value={
              data?.rememberMe
                ? t("feature.admin.auth.session.on")
                : t("feature.admin.auth.session.off")
            }
          />
        </CardBody>
      </Card>
    </ReadTab>
  );
}
