import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import {
  Card,
  CardBody,
  Badge,
  Button,
  Select,
  type SelectItem,
  Switch,
  FormField,
  LoadingState,
  LiveRegion,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import {
  EMAIL_SENDER_PROVIDERS,
  type EmailSenderSettings,
  type UpdateEmailSenderSettings,
} from "@platform/contracts-admin";
import { useSession } from "../../hooks/use-session";
import { AdminQueryError } from "../admin/AdminQueryError";
import { useEmailSender, useUpdateEmailSender, useTestEmailSender } from "./use-admin-email";

interface EmailForm {
  provider: (typeof EMAIL_SENDER_PROVIDERS)[number];
  fromName: string;
  fromEmail: string;
  replyToEmail: string;
  enabled: boolean;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpPassword: string;
  apiKey: string;
}

function toForm(s: EmailSenderSettings): EmailForm {
  return {
    provider: s.provider,
    fromName: s.fromName,
    fromEmail: s.fromEmail,
    replyToEmail: s.replyToEmail,
    enabled: s.enabled,
    smtpHost: s.smtpHost,
    smtpPort: s.smtpPort ? String(s.smtpPort) : "",
    smtpSecure: s.smtpSecure,
    smtpUsername: s.smtpUsername,
    smtpPassword: "", // never prefilled
    apiKey: "", // never prefilled
  };
}

/**
 * Tenant email sender configuration (ADR-0047). Read-only unless the actor holds
 * `tenant.email.settings.write`. The credential is write-only and never displayed.
 */
export function AdminEmailPage() {
  const t = useTranslation();
  const { hasPermission } = useSession();
  const canWrite = hasPermission("tenant.email.settings.write");
  const { data, isLoading, isError, error, refetch } = useEmailSender();

  if (isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (isError) return <AdminQueryError error={error} onRetry={() => void refetch()} />;
  const settings = data!;

  return (
    <div className="space-y-6" data-testid="admin-email">
      <header>
        <h1 className="text-lg font-semibold text-fg">{t("feature.admin.email.title")}</h1>
        <p className="text-sm text-fg-muted">{t("feature.admin.email.description")}</p>
      </header>

      <ReadinessBanner readiness={settings.readiness} />
      <SettingsForm settings={settings} canWrite={canWrite} />
      <TestEmailCard canWrite={canWrite} provider={settings.provider} />
    </div>
  );
}

function readinessTone(readiness: EmailSenderSettings["readiness"]): string {
  if (readiness === "configured") return "success";
  if (readiness === "missing_sender") return "secondary";
  return "warning";
}

function ReadinessBanner({ readiness }: Readonly<{ readiness: EmailSenderSettings["readiness"] }>) {
  const t = useTranslation();
  const tone = readinessTone(readiness);
  return (
    <Card>
      <CardBody>
        <p className="text-sm font-medium text-fg">{t("feature.admin.email.readinessHeading")}</p>
        <div className="mt-1 flex items-center gap-2">
          <Badge
            variant={tone === "success" ? "default" : "secondary"}
            data-testid="admin-email-readiness-badge"
          >
            {readiness}
          </Badge>
          <span className="text-sm text-fg-muted" data-testid="admin-email-readiness-text">
            {t(`feature.admin.email.readiness.${readiness}`)}
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

function providerItems(t: (k: string) => string): SelectItem[] {
  return EMAIL_SENDER_PROVIDERS.map((id) => ({
    id,
    label: t(`feature.admin.email.provider.${id}`),
  }));
}

function SettingsForm({
  settings,
  canWrite,
}: {
  settings: EmailSenderSettings;
  canWrite: boolean;
}) {
  const t = useTranslation();
  const update = useUpdateEmailSender();
  const { control, handleSubmit, watch } = useForm<EmailForm>({ values: toForm(settings) });
  const provider = watch("provider");

  function onSubmit(v: EmailForm) {
    const payload: UpdateEmailSenderSettings = {
      provider: v.provider,
      fromName: v.fromName,
      fromEmail: v.fromEmail,
      replyToEmail: v.replyToEmail,
      enabled: v.enabled,
      ...(v.provider === "smtp"
        ? {
            smtpHost: v.smtpHost,
            smtpPort: Number(v.smtpPort) || 587,
            smtpSecure: v.smtpSecure,
            ...(v.smtpUsername ? { smtpUsername: v.smtpUsername } : {}),
          }
        : {}),
      ...(v.smtpPassword ? { smtpPassword: v.smtpPassword } : {}),
      ...(v.apiKey ? { apiKey: v.apiKey } : {}),
    };
    update.mutate(payload);
  }

  return (
    <Card>
      <CardBody>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-3"
          data-testid="admin-email-form"
        >
          <Controller
            control={control}
            name="provider"
            render={({ field }) => (
              <div>
                <label id="email-provider-label" className="mb-1 block text-sm font-medium text-fg">
                  {t("feature.admin.email.providerLabel")}
                </label>
                <Select
                  items={providerItems(t)}
                  placeholder={t("feature.admin.email.providerLabel")}
                  selectedKey={field.value}
                  aria-labelledby="email-provider-label"
                  isDisabled={!canWrite}
                  onSelectionChange={(k) => field.onChange(String(k))}
                  data-testid="admin-email-provider"
                />
              </div>
            )}
          />
          <Field
            control={control}
            name="fromName"
            label={t("feature.admin.email.fromNameLabel")}
            disabled={!canWrite}
          />
          <Field
            control={control}
            name="fromEmail"
            label={t("feature.admin.email.fromEmailLabel")}
            disabled={!canWrite}
          />
          <Field
            control={control}
            name="replyToEmail"
            label={t("feature.admin.email.replyToLabel")}
            disabled={!canWrite}
          />

          {provider === "smtp" && (
            <>
              <Field
                control={control}
                name="smtpHost"
                label={t("feature.admin.email.smtpHostLabel")}
                disabled={!canWrite}
              />
              <Field
                control={control}
                name="smtpPort"
                label={t("feature.admin.email.smtpPortLabel")}
                disabled={!canWrite}
              />
              <Field
                control={control}
                name="smtpUsername"
                label={t("feature.admin.email.smtpUsernameLabel")}
                disabled={!canWrite}
              />
              <Field
                control={control}
                name="smtpPassword"
                type="password"
                label={t("feature.admin.email.smtpPasswordLabel")}
                description={t("feature.admin.email.secretHelper")}
                disabled={!canWrite}
              />
              <Controller
                control={control}
                name="smtpSecure"
                render={({ field }) => (
                  <Switch
                    isSelected={field.value}
                    onChange={field.onChange}
                    isDisabled={!canWrite}
                    data-testid="admin-email-smtpSecure"
                  >
                    {t("feature.admin.email.smtpSecureLabel")}
                  </Switch>
                )}
              />
            </>
          )}
          {provider === "brevo" && (
            <Field
              control={control}
              name="apiKey"
              type="password"
              label={t("feature.admin.email.apiKeyLabel")}
              description={t("feature.admin.email.secretHelper")}
              disabled={!canWrite}
            />
          )}

          <Controller
            control={control}
            name="enabled"
            render={({ field }) => (
              <Switch
                isSelected={field.value}
                onChange={field.onChange}
                isDisabled={!canWrite}
                data-testid="admin-email-enabled"
              >
                {t("feature.admin.email.enabledLabel")}
              </Switch>
            )}
          />

          <p className="text-xs text-fg-muted" data-testid="admin-email-credential-state">
            {settings.hasCredential
              ? t("feature.admin.email.credentialSet")
              : t("feature.admin.email.noCredential")}
          </p>

          {update.isError && (
            <p role="alert" className="text-sm text-danger" data-testid="admin-email-save-error">
              {t("feature.admin.email.saveError")}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <LiveRegion
              tone="polite"
              className="text-sm text-success"
              data-testid="admin-email-saved"
            >
              {update.isSuccess ? t("feature.admin.email.saved") : ""}
            </LiveRegion>
            {canWrite && (
              <Button
                size="sm"
                type="submit"
                isDisabled={update.isPending}
                data-testid="admin-email-submit"
              >
                {t("feature.admin.email.save")}
              </Button>
            )}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function testResultText(
  t: (k: string) => string,
  state: Readonly<{ isPending: boolean; isError: boolean; result: string | undefined }>
): string {
  if (state.isPending) return t("auth.status.loading");
  if (state.isError) return t("feature.admin.email.testError");
  if (state.result) return t(`feature.admin.email.testResult.${state.result}`);
  return "";
}

function TestEmailCard({ canWrite, provider }: Readonly<{ canWrite: boolean; provider: string }>) {
  const t = useTranslation();
  const test = useTestEmailSender();
  const [to, setTo] = useState("");
  const result = test.data?.result;

  return (
    <Card>
      <CardBody className="space-y-2">
        <p className="text-sm font-medium text-fg">{t("feature.admin.email.testHeading")}</p>
        <FormField
          label={t("feature.admin.email.testRecipientLabel")}
          value={to}
          onChange={setTo}
          isDisabled={!canWrite || provider === "disabled"}
          inputProps={{ "data-testid": "admin-email-test-to" }}
        />
        <div className="flex items-center gap-2">
          {canWrite && (
            <Button
              size="sm"
              variant="outline"
              type="button"
              isDisabled={test.isPending || provider === "disabled" || !to.trim()}
              onPress={() => test.mutate({ to: to.trim() })}
              data-testid="admin-email-test-submit"
            >
              {t("feature.admin.email.testButton")}
            </Button>
          )}
          <LiveRegion tone="polite" className="text-sm" data-testid="admin-email-test-result">
            {testResultText(t, {
              isPending: test.isPending,
              isError: test.isError,
              result,
            })}
          </LiveRegion>
        </div>
      </CardBody>
    </Card>
  );
}

function Field({
  control,
  name,
  label,
  type,
  description,
  disabled,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  name: keyof EmailForm;
  label: string;
  type?: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormField
          label={label}
          type={type}
          description={description}
          value={field.value ?? ""}
          onChange={field.onChange}
          onBlur={field.onBlur}
          name={field.name}
          isDisabled={disabled}
          isInvalid={!!fieldState.error}
          errorMessage={fieldState.error?.message}
          inputProps={{ "data-testid": `admin-email-field-${name}` }}
        />
      )}
    />
  );
}
