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
  Button,
  FormField,
  LoadingState,
  EmptyState,
  LiveRegion,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import {
  PRODUCT_PROVIDER_IDS,
  MfaPolicySchema,
  type ProductProviderId,
  type SessionPolicyDto,
  type MfaPolicyDto,
  type LockoutPolicyDto,
} from "@platform/contracts-admin";
import { useSession } from "../../hooks/use-session";
import { AdminSectionHeader } from "../../components/AdminLayout";
import { AdminQueryError } from "../admin/AdminQueryError";
import { AuditTrailPanel } from "../admin/AuditTrailPanel";
import { IdpManager } from "./IdpManager";
import {
  useAuthProviders,
  useSetAuthProviders,
  useMfaPolicy,
  useSetMfaPolicy,
  useLockoutPolicy,
  useSetLockoutPolicy,
  useSessionPolicy,
  useAuthReadiness,
  useSetSessionPolicy,
} from "./use-admin-auth";

const MFA_REQUIRED_LEVELS = ["none", "optional", "required"] as const;

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
      { id: "lockout", label: t("feature.admin.auth.tab.lockout"), content: <LockoutTab /> },
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

function ProvidersTab({ canWrite }: Readonly<{ canWrite: boolean }>) {
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
/**
 * Identity Providers tab (ADR-0043) — readiness-gated realm IdP management.
 * Editable (create/update/enable-disable/delete) only when readiness is
 * `configured` and the user has write permission; otherwise a read-only list or
 * the precise readiness notice. Secrets are never displayed.
 */
function IdpsTab() {
  const t = useTranslation();
  const { hasPermission } = useSession();
  const canWrite = hasPermission("tenant.auth.settings.write");
  const readiness = useAuthReadiness();

  if (readiness.isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (readiness.isError) return <AdminQueryError error={readiness.error} />;

  const status = readiness.data?.status;
  const editable = status === "configured" && canWrite;

  return (
    <div className="space-y-4" data-testid="auth-idps-tab">
      {status && status !== "configured" && (
        <Card>
          <CardBody>
            <output className="text-sm text-fg-muted" data-testid="auth-idps-readiness">
              {t(`feature.admin.auth.readiness.${status}` as const)}
            </output>
          </CardBody>
        </Card>
      )}
      <IdpManager editable={editable} />
      <div className="border-t border-border pt-4">
        <AuditTrailPanel
          resource="auth_settings"
          action="auth_settings.idp.changed"
          heading={t("feature.admin.auth.idps.recentChanges")}
          testId="auth-idps-audit"
        />
      </div>
    </div>
  );
}

function Detail({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="font-medium text-fg">{value}</span>
    </div>
  );
}

/**
 * MFA policy tab (ADR-0042) — the second writable Auth tab, reusing the Session
 * readiness gate verbatim. Only the `required` level is editable; the factor
 * `type` is read-only (TOTP) and `gracePeriodSeconds` is not exposed this slice.
 */
function MfaTab() {
  const t = useTranslation();
  const { hasPermission } = useSession();
  const canWrite = hasPermission("tenant.auth.settings.write");
  const readiness = useAuthReadiness();

  if (readiness.isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (readiness.isError) return <AdminQueryError error={readiness.error} />;

  const status = readiness.data?.status;
  const editable = status === "configured" && canWrite;

  return (
    <div className="space-y-4" data-testid="auth-mfa">
      {status && status !== "configured" && (
        <Card>
          <CardBody>
            <output className="text-sm text-fg-muted" data-testid="auth-mfa-readiness">
              {t(`feature.admin.auth.readiness.${status}` as const)}
            </output>
          </CardBody>
        </Card>
      )}
      <MfaPolicyView editable={editable} />
      <div className="border-t border-border pt-4">
        <AuditTrailPanel
          resource="auth_settings"
          action="auth_settings.mfa.changed"
          heading={t("feature.admin.auth.mfa.recentChanges")}
          testId="auth-mfa-audit"
        />
      </div>
    </div>
  );
}

function MfaPolicyView({ editable }: Readonly<{ editable: boolean }>) {
  const t = useTranslation();
  const { data, isLoading, isError, error } = useMfaPolicy();

  if (isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (isError) return <AdminQueryError error={error} />;
  if (!data) return <EmptyState title={t("feature.admin.auth.notConfigured")} />;
  if (editable) return <MfaPolicyForm policy={data} />;

  return (
    <Card>
      <CardBody className="divide-y divide-border">
        <div data-testid="auth-mfa-readonly" className="divide-y divide-border">
          <Detail
            label={t("feature.admin.auth.mfa.required")}
            value={t(`feature.admin.auth.mfa.requiredOption.${data.required}` as const)}
          />
          <Detail
            label={t("feature.admin.auth.mfa.type")}
            value={t(`feature.admin.auth.mfa.typeName.${data.type}` as const)}
          />
        </div>
      </CardBody>
    </Card>
  );
}

function MfaPolicyForm({ policy }: Readonly<{ policy: MfaPolicyDto }>) {
  const t = useTranslation();
  const mutation = useSetMfaPolicy();
  const { control, handleSubmit, formState } = useForm<MfaPolicyDto>({
    resolver: zodResolver(MfaPolicySchema),
    defaultValues: policy,
  });

  const requiredItems: SelectItem[] = MFA_REQUIRED_LEVELS.map((level) => ({
    id: level,
    label: t(`feature.admin.auth.mfa.requiredOption.${level}` as const),
  }));

  function onSubmit(values: MfaPolicyDto) {
    mutation.mutate(values);
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" data-testid="auth-mfa-form">
          <Controller
            name="required"
            control={control}
            render={({ field }) => (
              <div className="max-w-xs">
                <label className="mb-1 block text-sm font-medium text-fg" id="mfa-required-label">
                  {t("feature.admin.auth.mfa.required")}
                </label>
                <Select
                  items={requiredItems}
                  placeholder={t("feature.admin.auth.mfa.required")}
                  selectedKey={field.value}
                  aria-labelledby="mfa-required-label"
                  onSelectionChange={(key) => field.onChange(String(key))}
                  data-testid="auth-mfa-required"
                />
              </div>
            )}
          />
          {/* Factor type is read-only this slice (TOTP authoritative). */}
          <Detail
            label={t("feature.admin.auth.mfa.type")}
            value={t(`feature.admin.auth.mfa.typeName.${policy.type}` as const)}
          />
          {mutation.isError && (
            <p role="alert" className="text-sm text-danger" data-testid="auth-mfa-error">
              {t("feature.admin.auth.mfa.saveError")}
            </p>
          )}
          <div className="flex items-center justify-between gap-4">
            <LiveRegion
              tone="polite"
              className="text-sm text-success"
              data-testid="auth-mfa-status"
            >
              {mutation.isSuccess ? t("feature.admin.auth.mfa.saved") : ""}
            </LiveRegion>
            <Button
              size="sm"
              type="submit"
              isDisabled={mutation.isPending || !formState.isDirty}
              data-testid="auth-mfa-submit"
            >
              {t("feature.admin.auth.mfa.save")}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

const LOCKOUT_NUMERIC_FIELDS = [
  { name: "maxFailureWaitSeconds", labelKey: "feature.admin.auth.lockout.maxFailureWaitSeconds" },
  { name: "failureFactor", labelKey: "feature.admin.auth.lockout.failureFactor" },
  {
    name: "waitIncrementSeconds",
    labelKey: "feature.admin.auth.lockout.waitIncrementSeconds",
  },
  {
    name: "quickLoginCheckMilliSeconds",
    labelKey: "feature.admin.auth.lockout.quickLoginCheckMilliSeconds",
  },
  {
    name: "minimumQuickLoginWaitSeconds",
    labelKey: "feature.admin.auth.lockout.minimumQuickLoginWaitSeconds",
  },
  { name: "maxDeltaTimeSeconds", labelKey: "feature.admin.auth.lockout.maxDeltaTimeSeconds" },
  {
    name: "failureResetTimeSeconds",
    labelKey: "feature.admin.auth.lockout.failureResetTimeSeconds",
  },
] as const satisfies ReadonlyArray<{
  name: keyof Pick<
    LockoutPolicyDto,
    | "maxFailureWaitSeconds"
    | "failureFactor"
    | "waitIncrementSeconds"
    | "quickLoginCheckMilliSeconds"
    | "minimumQuickLoginWaitSeconds"
    | "maxDeltaTimeSeconds"
    | "failureResetTimeSeconds"
  >;
  labelKey: string;
}>;

function LockoutTab() {
  const t = useTranslation();
  const { hasPermission } = useSession();
  const canWrite = hasPermission("tenant.auth.settings.write");
  const readiness = useAuthReadiness();

  if (readiness.isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (readiness.isError) return <AdminQueryError error={readiness.error} />;

  const status = readiness.data?.status;
  const editable = status === "configured" && canWrite;

  return (
    <div className="space-y-4" data-testid="auth-lockout">
      {status && status !== "configured" && (
        <Card>
          <CardBody>
            <output className="text-sm text-fg-muted" data-testid="auth-lockout-readiness">
              {t(`feature.admin.auth.readiness.${status}` as const)}
            </output>
          </CardBody>
        </Card>
      )}
      <LockoutPolicyView editable={editable} />
      <div className="border-t border-border pt-4">
        <AuditTrailPanel
          resource="auth_settings"
          action="auth_settings.lockout.changed"
          heading={t("feature.admin.auth.lockout.recentChanges")}
          testId="auth-lockout-audit"
        />
      </div>
    </div>
  );
}

function LockoutPolicyView({ editable }: Readonly<{ editable: boolean }>) {
  const t = useTranslation();
  const { data, isLoading, isError, error } = useLockoutPolicy();
  if (isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (isError) return <AdminQueryError error={error} />;
  if (!data) return <EmptyState title={t("feature.admin.auth.notConfigured")} />;
  if (editable) return <LockoutPolicyForm policy={data} />;
  return (
    <Card>
      <CardBody className="divide-y divide-border">
        <div data-testid="auth-lockout-readonly" className="divide-y divide-border">
          <Detail
            label={t("feature.admin.auth.lockout.enabled")}
            value={
              data.enabled
                ? t("feature.admin.auth.session.on")
                : t("feature.admin.auth.session.off")
            }
          />
          <Detail
            label={t("feature.admin.auth.lockout.permanentLockout")}
            value={
              data.permanentLockout
                ? t("feature.admin.auth.session.on")
                : t("feature.admin.auth.session.off")
            }
          />
          {LOCKOUT_NUMERIC_FIELDS.map((f) => (
            <Detail key={f.name} label={t(f.labelKey)} value={String(data[f.name] ?? "")} />
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function LockoutPolicyForm({ policy }: Readonly<{ policy: LockoutPolicyDto }>) {
  const t = useTranslation();
  const mutation = useSetLockoutPolicy();
  const { control, handleSubmit, formState } = useForm<LockoutPolicyDto>({
    resolver: zodResolver(
      z.object({
        enabled: z.boolean(),
        maxFailureWaitSeconds: z.number().int().min(1),
        failureFactor: z.number().int().min(1),
        waitIncrementSeconds: z.number().int().min(1),
        quickLoginCheckMilliSeconds: z.number().int().min(1),
        minimumQuickLoginWaitSeconds: z.number().int().min(1),
        maxDeltaTimeSeconds: z.number().int().min(1),
        failureResetTimeSeconds: z.number().int().min(1),
        permanentLockout: z.boolean(),
      })
    ),
    defaultValues: policy,
  });
  function onSubmit(values: LockoutPolicyDto) {
    mutation.mutate(values);
  }
  return (
    <Card>
      <CardBody>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
          data-testid="auth-lockout-form"
        >
          <Controller
            name="enabled"
            control={control}
            render={({ field }) => (
              <Switch
                isSelected={!!field.value}
                onChange={field.onChange}
                data-testid="auth-lockout-enabled"
              >
                {t("feature.admin.auth.lockout.enabled")}
              </Switch>
            )}
          />
          <Controller
            name="permanentLockout"
            control={control}
            render={({ field }) => (
              <Switch
                isSelected={!!field.value}
                onChange={field.onChange}
                data-testid="auth-lockout-permanentLockout"
              >
                {t("feature.admin.auth.lockout.permanentLockout")}
              </Switch>
            )}
          />
          {LOCKOUT_NUMERIC_FIELDS.map((f) => (
            <Controller
              key={f.name}
              name={f.name}
              control={control}
              render={({ field }) => (
                <FormField
                  label={t(f.labelKey)}
                  type="number"
                  value={String(field.value ?? "")}
                  onChange={(v) => field.onChange(Number(v))}
                  onBlur={field.onBlur}
                  name={field.name}
                  inputProps={{ "data-testid": `auth-lockout-${f.name}` }}
                />
              )}
            />
          ))}
          {mutation.isError && (
            <p role="alert" className="text-sm text-danger" data-testid="auth-lockout-error">
              {t("feature.admin.auth.lockout.saveError")}
            </p>
          )}
          <div className="flex items-center justify-between gap-4">
            <LiveRegion
              tone="polite"
              className="text-sm text-success"
              data-testid="auth-lockout-status"
            >
              {mutation.isSuccess ? t("feature.admin.auth.lockout.saved") : ""}
            </LiveRegion>
            <Button
              size="sm"
              type="submit"
              isDisabled={mutation.isPending || !formState.isDirty}
              data-testid="auth-lockout-submit"
            >
              {t("feature.admin.auth.lockout.save")}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
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
            <output className="text-sm text-fg-muted" data-testid="auth-session-readiness">
              {t(`feature.admin.auth.readiness.${status}` as const)}
            </output>
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
function SessionPolicyView({ editable }: Readonly<{ editable: boolean }>) {
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

function SessionPolicyForm({ policy }: Readonly<{ policy: SessionPolicyDto }>) {
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
