import { useMemo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card,
  CardBody,
  Tabs,
  type TabItem,
  Select,
  type SelectItem,
  Switch,
  Badge,
  Button,
  FormField,
  LoadingState,
  EmptyState,
  LiveRegion,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import {
  PRODUCT_PROVIDER_IDS,
  type ProductProviderId,
  type SessionPolicyDto,
} from "@platform/contracts-admin";
import { useSession } from "../../hooks/use-session";
import { AdminSectionHeader } from "../../components/AdminLayout";
import { AdminQueryError } from "../admin/AdminQueryError";
import { AuditTrailPanel } from "../admin/AuditTrailPanel";
import {
  useAuthProviders,
  useSetAuthProviders,
  useIdps,
  useMfaPolicy,
  useSessionPolicy,
  useAuthReadiness,
  useSetSessionPolicy,
} from "./use-admin-auth";

// Client-side validation mirrors the BFF SessionBodySchema ranges so the form
// fails fast with a clear message; the server remains the enforcement point.
const SessionFormSchema = z.object({
  accessTokenLifespanSeconds: z.number().int().min(60).max(86400),
  ssoSessionIdleTimeoutSeconds: z.number().int().min(300).max(86400),
  ssoSessionMaxLifespanSeconds: z.number().int().min(3600).max(2592000),
  rememberMe: z.boolean(),
});

const SESSION_NUMERIC_FIELDS = [
  {
    name: "accessTokenLifespanSeconds",
    labelKey: "feature.admin.auth.session.accessTokenLifespan",
  },
  { name: "ssoSessionIdleTimeoutSeconds", labelKey: "feature.admin.auth.session.idleTimeout" },
  { name: "ssoSessionMaxLifespanSeconds", labelKey: "feature.admin.auth.session.maxLifespan" },
] as const;

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
  const { data, isLoading, isError, error, refetch } = useAuthProviders();
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
  if (isError) return <AdminQueryError error={error} onRetry={() => void refetch()} />;
  if (!data) return <EmptyState title={t("feature.admin.auth.providers.unavailable")} />;

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

        <div className="border-t border-border pt-4">
          <AuditTrailPanel
            resource="auth_settings"
            resourceId="providers"
            heading={t("feature.admin.auth.providers.recentChanges")}
            testId="auth-providers-audit"
          />
        </div>
      </CardBody>
    </Card>
  );
}

/** Shared graceful wrapper for the read-only realm tabs. A missing per-tenant
 * service-account credential (503 NO_CREDENTIAL) classifies as "not configured";
 * 401/403/other failures get their proper states via AdminQueryError. */
function ReadTab({
  isLoading,
  isError,
  error,
  hasData,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  hasData: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslation();
  if (isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (isError) return <AdminQueryError error={error} />;
  if (!hasData) return <EmptyState title={t("feature.admin.auth.notConfigured")} />;
  return <>{children}</>;
}

function IdpsTab() {
  const t = useTranslation();
  const { data, isLoading, isError, error } = useIdps();
  return (
    <ReadTab isLoading={isLoading} isError={isError} error={error} hasData={!!data}>
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
  const { data, isLoading, isError, error } = useMfaPolicy();
  return (
    <ReadTab isLoading={isLoading} isError={isError} error={error} hasData={!!data}>
      <Card>
        <CardBody className="divide-y divide-border" data-testid="auth-mfa">
          <Detail label={t("feature.admin.auth.mfa.required")} value={data?.required ?? ""} />
          <Detail label={t("feature.admin.auth.mfa.type")} value={data?.type ?? ""} />
        </CardBody>
      </Card>
    </ReadTab>
  );
}

/**
 * Session policy tab (ADR-0041) — the first writable Auth tab. Editing is gated on
 * the credential readiness probe: only when the per-tenant realm-admin credential
 * is `configured` (and the user has write permission) is the editable form shown.
 * Any other readiness status surfaces a precise "why editing is unavailable"
 * notice instead of a writable form or an opaque error.
 */
function SessionTab() {
  const t = useTranslation();
  const { hasPermission } = useSession();
  const canWrite = hasPermission("tenant.auth.settings.write");
  const readiness = useAuthReadiness();

  if (readiness.isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (readiness.isError) return <AdminQueryError error={readiness.error} />;

  const status = readiness.data?.status;
  const editable = status === "configured" && canWrite;

  return (
    <div className="space-y-4" data-testid="auth-session">
      {status && status !== "configured" && (
        <Card>
          <CardBody>
            <p role="status" className="text-sm text-fg-muted" data-testid="auth-session-readiness">
              {t(`feature.admin.auth.readiness.${status}` as const)}
            </p>
          </CardBody>
        </Card>
      )}
      <SessionPolicyView editable={editable} />
      <div className="border-t border-border pt-4">
        <AuditTrailPanel
          resource="auth_settings"
          action="auth_settings.session.changed"
          heading={t("feature.admin.auth.session.recentChanges")}
          testId="auth-session-audit"
        />
      </div>
    </div>
  );
}

/** Loads the session policy then renders either the read-only details or the
 * editable form. The policy GET 503s when no credential exists, so it is only
 * fetched when we have a chance of data (configured or any non-missing state). */
function SessionPolicyView({ editable }: { editable: boolean }) {
  const t = useTranslation();
  const { data, isLoading, isError, error } = useSessionPolicy();

  if (isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (isError) return <AdminQueryError error={error} />;
  if (!data) return <EmptyState title={t("feature.admin.auth.notConfigured")} />;
  if (editable) return <SessionPolicyForm policy={data} />;

  return (
    <Card>
      <CardBody className="divide-y divide-border">
        <div data-testid="auth-session-readonly" className="divide-y divide-border">
          <Detail
            label={t("feature.admin.auth.session.accessTokenLifespan")}
            value={`${data.accessTokenLifespanSeconds}s`}
          />
          <Detail
            label={t("feature.admin.auth.session.idleTimeout")}
            value={`${data.ssoSessionIdleTimeoutSeconds}s`}
          />
          <Detail
            label={t("feature.admin.auth.session.maxLifespan")}
            value={`${data.ssoSessionMaxLifespanSeconds}s`}
          />
          <Detail
            label={t("feature.admin.auth.session.rememberMe")}
            value={
              data.rememberMe
                ? t("feature.admin.auth.session.on")
                : t("feature.admin.auth.session.off")
            }
          />
        </div>
      </CardBody>
    </Card>
  );
}

function SessionPolicyForm({ policy }: { policy: SessionPolicyDto }) {
  const t = useTranslation();
  const mutation = useSetSessionPolicy();
  const { control, handleSubmit, formState } = useForm<SessionPolicyDto>({
    resolver: zodResolver(SessionFormSchema),
    defaultValues: policy,
  });

  function onSubmit(values: SessionPolicyDto) {
    mutation.mutate(values);
  }

  return (
    <Card>
      <CardBody>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
          data-testid="auth-session-form"
        >
          {SESSION_NUMERIC_FIELDS.map((f) => (
            <Controller
              key={f.name}
              name={f.name}
              control={control}
              render={({ field, fieldState }) => (
                <FormField
                  label={`${t(f.labelKey)} (${t("feature.admin.auth.session.seconds")})`}
                  type="number"
                  value={
                    field.value == null || Number.isNaN(field.value) ? "" : String(field.value)
                  }
                  onChange={(v) => field.onChange(v === "" ? Number.NaN : Number(v))}
                  onBlur={field.onBlur}
                  name={field.name}
                  isInvalid={!!fieldState.error}
                  errorMessage={
                    fieldState.error ? t("feature.admin.auth.session.invalid") : undefined
                  }
                  inputProps={{ "data-testid": `auth-session-${f.name}` }}
                />
              )}
            />
          ))}
          <Controller
            name="rememberMe"
            control={control}
            render={({ field }) => (
              <Switch
                isSelected={!!field.value}
                onChange={field.onChange}
                data-testid="auth-session-rememberMe"
              >
                {t("feature.admin.auth.session.rememberMe")}
              </Switch>
            )}
          />
          {mutation.isError && (
            <p role="alert" className="text-sm text-danger" data-testid="auth-session-error">
              {t("feature.admin.auth.session.saveError")}
            </p>
          )}
          <div className="flex items-center justify-between gap-4">
            <LiveRegion
              tone="polite"
              className="text-sm text-success"
              data-testid="auth-session-status"
            >
              {mutation.isSuccess ? t("feature.admin.auth.session.saved") : ""}
            </LiveRegion>
            <Button
              size="sm"
              type="submit"
              isDisabled={mutation.isPending || !formState.isDirty}
              data-testid="auth-session-submit"
            >
              {t("feature.admin.auth.session.save")}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
