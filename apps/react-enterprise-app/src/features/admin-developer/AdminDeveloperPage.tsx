import { useMemo, useState, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Badge,
  Button,
  Card,
  CardBody,
  DataTable,
  EmptyState,
  FormField,
  LoadingState,
  Select,
  type SelectItem,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import type {
  ApiKeySummary,
  CreateApiKeyResponse,
  EntitlementKey,
  RateLimitPolicySummary,
} from "@platform/contracts-admin";
import { useSession } from "../../hooks/use-session";
import { AdminSectionHeader } from "../../components/AdminLayout";
import { AdminQueryError } from "../admin/AdminQueryError";
import { useTenantLookup } from "../admin-entitlements/use-admin-entitlements";
import {
  useCreateApiKey,
  useDeveloperPortal,
  useMyApiKeys,
  useMyRateLimits,
  useRevokeApiKey,
  useSetRateLimit,
  useTenantApiKeys,
  useTenantRateLimits,
} from "./use-admin-developer";

const ENTITLEMENTS: EntitlementKey[] = [
  "api_access",
  "webhooks",
  "storage",
  "custom_domains",
  "advanced_observability",
];

function ApiKeyStateBadge({ state }: Readonly<{ state: ApiKeySummary["state"] }>) {
  const t = useTranslation();
  return (
    <Badge variant={state === "active" ? "default" : "secondary"}>
      {t(`feature.admin.developer.keyState.${state}`)}
    </Badge>
  );
}

function useApiKeyColumns(onRevoke?: (id: string) => void): ColumnDef<ApiKeySummary>[] {
  const t = useTranslation();
  return useMemo(
    () => [
      {
        header: t("feature.admin.developer.colName"),
        accessorKey: "name",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-fg">{row.original.name}</div>
            <div className="text-xs text-fg-muted">{row.original.keyPrefix}…</div>
          </div>
        ),
      },
      {
        header: t("feature.admin.developer.colScopes"),
        accessorKey: "scopes",
        cell: ({ row }) => row.original.scopes.join(", "),
      },
      {
        header: t("feature.admin.developer.colState"),
        accessorKey: "state",
        cell: ({ row }) => <ApiKeyStateBadge state={row.original.state} />,
      },
      ...(onRevoke
        ? [
            {
              header: t("feature.admin.developer.colActions"),
              id: "actions",
              cell: ({ row }: { row: { original: ApiKeySummary } }) =>
                row.original.state === "active" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => onRevoke(row.original.id)}
                    data-testid="api-key-revoke"
                  >
                    {t("feature.admin.developer.revoke")}
                  </Button>
                ) : null,
            } as ColumnDef<ApiKeySummary>,
          ]
        : []),
    ],
    [t, onRevoke]
  );
}

function useRateLimitColumns(): ColumnDef<RateLimitPolicySummary>[] {
  const t = useTranslation();
  return useMemo(
    () => [
      { header: t("feature.admin.developer.colPolicy"), accessorKey: "policyKey" },
      { header: t("feature.admin.developer.colEntitlement"), accessorKey: "entitlementKey" },
      {
        header: t("feature.admin.developer.colLimit"),
        accessorKey: "limit",
        cell: ({ row }) =>
          `${row.original.used} / ${row.original.limit} per ${row.original.windowSeconds}s`,
      },
      {
        header: t("feature.admin.developer.colState"),
        accessorKey: "state",
        cell: ({ row }) => (
          <Badge variant={row.original.state === "within" ? "default" : "secondary"}>
            {row.original.state}
          </Badge>
        ),
      },
    ],
    [t]
  );
}

// One-time secret reveal. The plaintext is shown once; we never refetch it.
function SecretReveal({
  created,
  onDismiss,
}: {
  created: CreateApiKeyResponse;
  onDismiss: () => void;
}) {
  const t = useTranslation();
  return (
    <Card>
      <CardBody>
        <div role="alert" data-testid="api-key-secret">
          <h2 className="mb-1 text-sm font-semibold text-fg">
            {t("feature.admin.developer.secretTitle")}
          </h2>
          <p className="mb-2 text-sm text-fg-muted">{t("feature.admin.developer.secretNote")}</p>
          <code
            className="block break-all rounded bg-surface-2 p-2 text-sm"
            data-testid="api-key-secret-value"
          >
            {created.secret}
          </code>
          <Button
            size="sm"
            className="mt-3"
            onPress={onDismiss}
            data-testid="api-key-secret-dismiss"
          >
            {t("feature.admin.developer.secretDismiss")}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function CreateApiKeyForm() {
  const t = useTranslation();
  const create = useCreateApiKey();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreateApiKeyResponse | null>(null);

  function submit() {
    if (name.trim().length === 0) return;
    create.mutate(
      { name: name.trim(), scopes: ["read"] },
      {
        onSuccess: (res) => {
          setCreated(res);
          setName("");
        },
      }
    );
  }

  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 text-sm font-semibold text-fg">
          {t("feature.admin.developer.createTitle")}
        </h2>
        <div className="flex flex-wrap items-end gap-3" data-testid="api-key-create-form">
          <div className="min-w-64">
            <FormField
              label={t("feature.admin.developer.nameLabel")}
              value={name}
              onChange={setName}
              name="name"
              inputProps={{ "data-testid": "api-key-name" }}
            />
          </div>
          <Button
            size="sm"
            onPress={submit}
            isDisabled={create.isPending}
            data-testid="api-key-create-submit"
          >
            {t("feature.admin.developer.create")}
          </Button>
        </div>
        {create.isError && (
          <p role="alert" className="mt-2 text-sm text-danger" data-testid="api-key-create-error">
            {t("feature.admin.developer.createError")}
          </p>
        )}
        {created && (
          <div className="mt-3">
            <SecretReveal created={created} onDismiss={() => setCreated(null)} />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function DeveloperFoundationCard() {
  const t = useTranslation();
  const portal = useDeveloperPortal();
  if (portal.isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (portal.isError)
    return <AdminQueryError error={portal.error} onRetry={() => void portal.refetch()} />;
  if (!portal.data) return null;
  const d = portal.data;
  return (
    <Card>
      <CardBody>
        <h2 className="mb-2 text-sm font-semibold text-fg">
          {t("feature.admin.developer.foundationTitle")}
        </h2>
        <dl className="grid grid-cols-2 gap-2 text-sm" data-testid="developer-foundation">
          <dt className="text-fg-muted">{t("feature.admin.developer.apiAccess")}</dt>
          <dd className="text-fg">
            {d.apiAccessEntitled
              ? t("feature.admin.developer.yes")
              : t("feature.admin.developer.no")}
          </dd>
          <dt className="text-fg-muted">{t("feature.admin.developer.activeKeys")}</dt>
          <dd className="text-fg">{d.activeKeyCount}</dd>
          <dt className="text-fg-muted">{t("feature.admin.developer.graphqlEndpoint")}</dt>
          <dd className="text-fg">
            <code>{d.graphqlEndpoint}</code>
          </dd>
          <dt className="text-fg-muted">{t("feature.admin.developer.openapi")}</dt>
          <dd className="text-fg">
            <code>{d.openapiPath}</code>
          </dd>
        </dl>
      </CardBody>
    </Card>
  );
}

function TenantDeveloperView() {
  const t = useTranslation();
  const keys = useMyApiKeys();
  const rateLimits = useMyRateLimits();
  const revoke = useRevokeApiKey();
  const columns = useApiKeyColumns((id) => revoke.mutate(id));
  const rlColumns = useRateLimitColumns();

  let keysContent: ReactNode;
  if (keys.isLoading) {
    keysContent = <LoadingState message={t("auth.status.loading")} />;
  } else if (keys.isError) {
    keysContent = <AdminQueryError error={keys.error} onRetry={() => void keys.refetch()} />;
  } else if (keys.data && keys.data.apiKeys.length > 0) {
    keysContent = (
      <Card>
        <CardBody>
          <DataTable data={keys.data.apiKeys} columns={columns} rowTestId="api-key-row" />
        </CardBody>
      </Card>
    );
  } else {
    keysContent = <EmptyState title={t("feature.admin.developer.noKeys")} />;
  }

  return (
    <div className="space-y-4">
      <DeveloperFoundationCard />
      <CreateApiKeyForm />
      {keysContent}
      {rateLimits.data && rateLimits.data.policies.length > 0 && (
        <Card>
          <CardBody>
            <h2 className="mb-2 text-sm font-semibold text-fg">
              {t("feature.admin.developer.rateLimitsTitle")}
            </h2>
            <DataTable
              data={rateLimits.data.policies}
              columns={rlColumns}
              rowTestId="rate-limit-row"
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function SetRateLimitForm({ tenantId }: Readonly<{ tenantId: string }>) {
  const t = useTranslation();
  const setRl = useSetRateLimit(tenantId);
  const [policyKey, setPolicyKey] = useState("api.requests");
  const [entitlementKey, setEntitlementKey] = useState<EntitlementKey>("api_access");
  const [limit, setLimit] = useState("1000");
  const [windowSeconds, setWindowSeconds] = useState("3600");

  const entitlementItems: SelectItem[] = ENTITLEMENTS.map((e) => ({ id: e, label: e }));

  function submit() {
    const n = Number(limit);
    const w = Number(windowSeconds);
    if (!Number.isInteger(n) || n < 0 || !Number.isInteger(w) || w <= 0) return;
    setRl.mutate({ policyKey, entitlementKey, limit: n, windowSeconds: w, action: "deny" });
  }

  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 text-sm font-semibold text-fg">
          {t("feature.admin.developer.setRateLimit")}
        </h2>
        <div className="flex flex-wrap items-end gap-3" data-testid="rate-limit-set-form">
          <div className="w-44">
            <FormField
              label={t("feature.admin.developer.policyLabel")}
              value={policyKey}
              onChange={setPolicyKey}
              name="policyKey"
              inputProps={{ "data-testid": "rate-limit-policy" }}
            />
          </div>
          <div className="min-w-48">
            <Select
              items={entitlementItems}
              placeholder={t("feature.admin.developer.entitlementLabel")}
              aria-label={t("feature.admin.developer.entitlementLabel")}
              selectedKey={entitlementKey}
              onSelectionChange={(k) => setEntitlementKey(String(k) as EntitlementKey)}
              data-testid="rate-limit-entitlement"
            />
          </div>
          <div className="w-28">
            <FormField
              label={t("feature.admin.developer.limitLabel")}
              value={limit}
              onChange={setLimit}
              name="limit"
              inputProps={{ inputMode: "numeric", "data-testid": "rate-limit-limit" }}
            />
          </div>
          <div className="w-28">
            <FormField
              label={t("feature.admin.developer.windowLabel")}
              value={windowSeconds}
              onChange={setWindowSeconds}
              name="windowSeconds"
              inputProps={{ inputMode: "numeric", "data-testid": "rate-limit-window" }}
            />
          </div>
          <Button
            size="sm"
            onPress={submit}
            isDisabled={setRl.isPending}
            data-testid="rate-limit-submit"
          >
            {t("feature.admin.developer.save")}
          </Button>
        </div>
        {setRl.isError && (
          <p role="alert" className="mt-2 text-sm text-danger" data-testid="rate-limit-error">
            {t("feature.admin.developer.saveError")}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function OperatorConsole() {
  const t = useTranslation();
  const [tenantId, setTenantId] = useState("");
  const tenants = useTenantLookup();
  const keys = useTenantApiKeys(tenantId);
  const rateLimits = useTenantRateLimits(tenantId);
  const keyColumns = useApiKeyColumns();
  const rlColumns = useRateLimitColumns();
  const tenantItems: SelectItem[] = useMemo(
    () =>
      (tenants.data?.tenants ?? []).map((tn) => ({
        id: tn.id,
        label: `${tn.slug} — ${tn.displayName}`,
      })),
    [tenants.data]
  );

  let tenantKeysContent: ReactNode;
  if (keys.isError) {
    tenantKeysContent = <AdminQueryError error={keys.error} onRetry={() => void keys.refetch()} />;
  } else if (keys.data && keys.data.apiKeys.length > 0) {
    tenantKeysContent = (
      <Card>
        <CardBody>
          <h2 className="mb-2 text-sm font-semibold text-fg">
            {t("feature.admin.developer.tenantKeysTitle")}
          </h2>
          <DataTable data={keys.data.apiKeys} columns={keyColumns} rowTestId="api-key-row" />
        </CardBody>
      </Card>
    );
  } else {
    tenantKeysContent = <EmptyState title={t("feature.admin.developer.noKeys")} />;
  }

  return (
    <div className="space-y-4">
      <div className="max-w-md" data-testid="developer-tenant-form">
        <label className="mb-1 block text-sm font-medium text-fg" id="developer-tenant-label">
          {t("feature.admin.developer.tenantSelectLabel")}
        </label>
        <Select
          items={tenantItems}
          placeholder={t("feature.admin.developer.tenantSelectPlaceholder")}
          aria-labelledby="developer-tenant-label"
          selectedKey={tenantId || null}
          onSelectionChange={(k) => setTenantId(k == null ? "" : String(k))}
          data-testid="developer-tenant-select"
        />
      </div>
      {tenantId === "" ? (
        <EmptyState title={t("feature.admin.developer.enterTenant")} />
      ) : (
        <>
          <SetRateLimitForm tenantId={tenantId} />
          {rateLimits.data && rateLimits.data.policies.length > 0 ? (
            <Card>
              <CardBody>
                <DataTable
                  data={rateLimits.data.policies}
                  columns={rlColumns}
                  rowTestId="rate-limit-row"
                />
              </CardBody>
            </Card>
          ) : (
            <EmptyState title={t("feature.admin.developer.noRateLimits")} />
          )}
          {tenantKeysContent}
        </>
      )}
    </div>
  );
}

export function AdminDeveloperPage() {
  const t = useTranslation();
  const { hasPermission } = useSession();
  // Operators (platform.rate_limits.write) get the cross-tenant console; tenant
  // admins get their own self-service developer surface (server-authoritative).
  const isOperator = hasPermission("platform.rate_limits.write");
  return (
    <section data-testid="admin-developer">
      <AdminSectionHeader
        heading={t("feature.admin.developer.title")}
        description={t("feature.admin.developer.description")}
      />
      {isOperator ? <OperatorConsole /> : <TenantDeveloperView />}
    </section>
  );
}
