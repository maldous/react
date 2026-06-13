import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  FormField,
  LoadingState,
  Select,
  type SelectItem,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPreference,
} from "@platform/contracts-admin";
import { useSession } from "../../hooks/use-session";
import { AdminSectionHeader } from "../../components/AdminLayout";
import { AdminQueryError } from "../admin/AdminQueryError";
import { useTenantLookup } from "../admin-entitlements/use-admin-entitlements";
import {
  useMyPreferences,
  useMyProfile,
  useNotificationReadiness,
  useTestNotification,
  useUpdatePreferences,
  useUpdateProfile,
} from "./use-admin-account";

function ProfileCard() {
  const t = useTranslation();
  const profile = useMyProfile();
  const update = useUpdateProfile();
  const [displayName, setDisplayName] = useState("");
  const [locale, setLocale] = useState("en-GB");
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    if (profile.data) {
      setDisplayName(profile.data.displayName);
      setLocale(profile.data.locale);
      setTimezone(profile.data.timezone);
    }
  }, [profile.data]);

  if (profile.isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (profile.isError)
    return <AdminQueryError error={profile.error} onRetry={() => void profile.refetch()} />;

  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 text-sm font-semibold text-fg">
          {t("feature.admin.account.profileTitle")}
        </h2>
        <div className="flex flex-wrap items-end gap-3" data-testid="profile-form">
          <div className="min-w-64">
            <FormField
              label={t("feature.admin.account.displayName")}
              value={displayName}
              onChange={setDisplayName}
              name="displayName"
              inputProps={{ "data-testid": "profile-display-name" }}
            />
          </div>
          <div className="w-28">
            <FormField
              label={t("feature.admin.account.locale")}
              value={locale}
              onChange={setLocale}
              name="locale"
              inputProps={{ "data-testid": "profile-locale" }}
            />
          </div>
          <div className="w-40">
            <FormField
              label={t("feature.admin.account.timezone")}
              value={timezone}
              onChange={setTimezone}
              name="timezone"
              inputProps={{ "data-testid": "profile-timezone" }}
            />
          </div>
          <Button
            size="sm"
            onPress={() => update.mutate({ displayName, locale, timezone })}
            isDisabled={update.isPending || displayName.trim().length === 0}
            data-testid="profile-save"
          >
            {t("feature.admin.account.save")}
          </Button>
        </div>
        {update.isError && (
          <p role="alert" className="mt-2 text-sm text-danger" data-testid="profile-error">
            {t("feature.admin.account.profileError")}
          </p>
        )}
        {update.isSuccess && (
          <p className="mt-2 text-sm text-fg-muted" data-testid="profile-saved">
            {t("feature.admin.account.saved")}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

// The (channel, category) pairs shown as preference toggles.
const PREF_PAIRS: { channel: NotificationChannel; category: NotificationCategory }[] =
  NOTIFICATION_CHANNELS.flatMap((channel) =>
    NOTIFICATION_CATEGORIES.map((category) => ({ channel, category }))
  );

function keyOf(channel: string, category: string) {
  return `${channel}:${category}`;
}

function PreferencesCard() {
  const t = useTranslation();
  const prefs = useMyPreferences();
  const update = useUpdatePreferences();
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (prefs.data) {
      const map: Record<string, boolean> = {};
      for (const p of prefs.data.preferences) map[keyOf(p.channel, p.category)] = p.enabled;
      setEnabled(map);
    }
  }, [prefs.data]);

  function save() {
    const preferences: NotificationPreference[] = PREF_PAIRS.map((p) => ({
      channel: p.channel,
      category: p.category,
      enabled: enabled[keyOf(p.channel, p.category)] ?? false,
    }));
    update.mutate({ preferences });
  }

  if (prefs.isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (prefs.isError)
    return <AdminQueryError error={prefs.error} onRetry={() => void prefs.refetch()} />;

  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 text-sm font-semibold text-fg">
          {t("feature.admin.account.preferencesTitle")}
        </h2>
        <div className="space-y-2" data-testid="preferences-form">
          {PREF_PAIRS.map((p) => {
            const k = keyOf(p.channel, p.category);
            const label = `${p.channel} · ${p.category}`;
            return (
              <label key={k} className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={enabled[k] ?? false}
                  onChange={(e) => setEnabled((prev) => ({ ...prev, [k]: e.target.checked }))}
                  aria-label={label}
                  data-testid={`pref-${k}`}
                />
                {label}
              </label>
            );
          })}
        </div>
        <Button
          size="sm"
          className="mt-3"
          onPress={save}
          isDisabled={update.isPending}
          data-testid="preferences-save"
        >
          {t("feature.admin.account.save")}
        </Button>
        {update.isSuccess && (
          <p className="mt-2 text-sm text-fg-muted" data-testid="preferences-saved">
            {t("feature.admin.account.saved")}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function OperatorNotifications() {
  const t = useTranslation();
  const readiness = useNotificationReadiness(true);
  const tenants = useTenantLookup();
  const [tenantId, setTenantId] = useState("");
  const [userId, setUserId] = useState("");
  const [category, setCategory] = useState<NotificationCategory>("system");
  const test = useTestNotification(tenantId);
  const tenantItems: SelectItem[] = useMemo(
    () =>
      (tenants.data?.tenants ?? []).map((tn) => ({
        id: tn.id,
        label: `${tn.slug} — ${tn.displayName}`,
      })),
    [tenants.data]
  );
  const categoryItems: SelectItem[] = NOTIFICATION_CATEGORIES.map((c) => ({ id: c, label: c }));

  return (
    <Card>
      <CardBody>
        <h2 className="mb-2 text-sm font-semibold text-fg">
          {t("feature.admin.account.notificationsTitle")}
        </h2>
        {readiness.isLoading ? (
          <LoadingState message={t("auth.status.loading")} />
        ) : readiness.isError ? (
          <AdminQueryError error={readiness.error} onRetry={() => void readiness.refetch()} />
        ) : readiness.data ? (
          <div className="mb-3 flex flex-wrap gap-2" data-testid="notification-readiness">
            {readiness.data.channels.map((c) => (
              <Badge key={c.channel} variant={c.available ? "default" : "secondary"}>
                {c.channel}: {c.transport}
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-3" data-testid="notification-test-form">
          <div className="min-w-56">
            <label className="mb-1 block text-sm font-medium text-fg" id="notif-tenant-label">
              {t("feature.admin.account.tenantSelectLabel")}
            </label>
            <Select
              items={tenantItems}
              placeholder={t("feature.admin.account.tenantSelectPlaceholder")}
              aria-labelledby="notif-tenant-label"
              selectedKey={tenantId || null}
              onSelectionChange={(k) => setTenantId(k == null ? "" : String(k))}
              data-testid="notification-tenant-select"
            />
          </div>
          <div className="w-48">
            <FormField
              label={t("feature.admin.account.userId")}
              value={userId}
              onChange={setUserId}
              name="userId"
              inputProps={{ "data-testid": "notification-user" }}
            />
          </div>
          <div className="w-40">
            <Select
              items={categoryItems}
              placeholder={t("feature.admin.account.category")}
              aria-label={t("feature.admin.account.category")}
              selectedKey={category}
              onSelectionChange={(k) => setCategory(String(k) as NotificationCategory)}
              data-testid="notification-category"
            />
          </div>
          <Button
            size="sm"
            onPress={() => tenantId && userId && test.mutate({ userId, category })}
            isDisabled={!tenantId || !userId || test.isPending}
            data-testid="notification-test-submit"
          >
            {t("feature.admin.account.sendTest")}
          </Button>
        </div>
        {test.isSuccess && (
          <p className="mt-2 text-sm text-fg-muted" data-testid="notification-test-result">
            {t("feature.admin.account.testResult", { count: test.data.dispatched.length })}
          </p>
        )}
        {test.isError && (
          <p
            role="alert"
            className="mt-2 text-sm text-danger"
            data-testid="notification-test-error"
          >
            {t("feature.admin.account.testError")}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

export function AdminAccountPage() {
  const t = useTranslation();
  const { hasPermission } = useSession();
  const isOperator = hasPermission("platform.notifications.write");
  return (
    <section data-testid="admin-account">
      <AdminSectionHeader
        heading={t("feature.admin.account.title")}
        description={t("feature.admin.account.description")}
      />
      <div className="space-y-4">
        <ProfileCard />
        <PreferencesCard />
        {isOperator && <OperatorNotifications />}
      </div>
    </section>
  );
}
