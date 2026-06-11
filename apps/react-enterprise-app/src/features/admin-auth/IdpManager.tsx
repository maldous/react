import { useState } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card,
  CardBody,
  Badge,
  Button,
  Dialog,
  Select,
  type SelectItem,
  Switch,
  FormField,
  LoadingState,
  EmptyState,
  LiveRegion,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import {
  IDP_PROVIDER_IDS,
  TENANT_ROLES,
  type IdpSummary,
  type CreateIdpRequest,
  type UpdateIdpRequest,
  type IdpMappingConfig,
  type OidcDiscoveryMetadata,
} from "@platform/contracts-admin";
import { AdminQueryError } from "../admin/AdminQueryError";
import {
  useIdps,
  useCreateIdp,
  useUpdateIdp,
  useDeleteIdp,
  useDiscoverOidc,
  useTestIdpConnection,
  useIdpCallbackUrl,
  useIdpMapping,
  useUpdateIdpMapping,
} from "./use-admin-auth";

// Local lenient form schemas: text inputs are strings ("" for unset), validated
// here for UX; empty optional fields are stripped before hitting the typed client,
// and the BFF re-validates strictly. URLs must be blank or http/https.
const httpsish = (v: string) => v === "" || /^https?:\/\/\S+$/i.test(v);

const CreateIdpFormSchema = z
  .object({
    alias: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,62}$/, "alias must be 2-63 lowercase/-/_ chars"),
    displayName: z.string().min(1).max(120),
    providerId: z.enum(IDP_PROVIDER_IDS),
    clientId: z.string().min(1).max(255),
    clientSecret: z.string().min(1).max(4096),
    issuer: z.string(),
    authorizationUrl: z.string(),
    tokenUrl: z.string(),
    userInfoUrl: z.string(),
    scopes: z.string(),
    trustEmail: z.boolean(),
  })
  .refine((b) => httpsish(b.authorizationUrl) && httpsish(b.tokenUrl), {
    message: "URLs must use http or https",
    path: ["authorizationUrl"],
  })
  .refine((b) => b.providerId !== "oidc" || (!!b.authorizationUrl && !!b.tokenUrl), {
    message: "oidc requires authorization and token URLs",
    path: ["authorizationUrl"],
  });
type CreateIdpForm = z.infer<typeof CreateIdpFormSchema>;

const EditIdpFormSchema = z
  .object({
    displayName: z.string().min(1).max(120),
    clientId: z.string().min(1).max(255),
    clientSecret: z.string().max(4096),
    authorizationUrl: z.string(),
    tokenUrl: z.string(),
    scopes: z.string(),
    trustEmail: z.boolean(),
    enabled: z.boolean(),
  })
  .refine((b) => httpsish(b.authorizationUrl) && httpsish(b.tokenUrl), {
    message: "URLs must use http or https",
    path: ["authorizationUrl"],
  });
type EditIdpForm = z.infer<typeof EditIdpFormSchema>;

type DialogState =
  | { mode: "create" }
  | { mode: "edit"; idp: IdpSummary }
  | { mode: "delete"; idp: IdpSummary }
  | { mode: "mapping"; idp: IdpSummary }
  | null;

/**
 * Identity Provider management (ADR-0043). Realm IdP definitions — distinct from
 * the product login allowlist on the Providers tab. Renders read-only unless
 * `editable`; secrets are never displayed (only `hasClientSecret`).
 */
export function IdpManager({ editable }: { editable: boolean }) {
  const t = useTranslation();
  const { data, isLoading, isError, error } = useIdps();
  const [dialog, setDialog] = useState<DialogState>(null);

  if (isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (isError) return <AdminQueryError error={error} />;
  const idps = data ?? [];

  return (
    <div className="space-y-4" data-testid="auth-idps">
      {editable && (
        <div className="flex justify-end">
          <Button
            size="sm"
            onPress={() => setDialog({ mode: "create" })}
            data-testid="auth-idp-create"
          >
            {t("feature.admin.auth.idps.add")}
          </Button>
        </div>
      )}

      {idps.length === 0 ? (
        <EmptyState title={t("feature.admin.auth.idps.empty")} />
      ) : (
        <Card>
          <CardBody className="divide-y divide-border">
            <div className="divide-y divide-border" data-testid="auth-idps-list">
              {idps.map((idp) => (
                <IdpRow
                  key={idp.alias}
                  idp={idp}
                  editable={editable}
                  onEdit={() => setDialog({ mode: "edit", idp })}
                  onDelete={() => setDialog({ mode: "delete", idp })}
                  onMapping={() => setDialog({ mode: "mapping", idp })}
                />
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {dialog?.mode === "create" && <CreateIdpDialog onClose={() => setDialog(null)} />}
      {dialog?.mode === "edit" && (
        <EditIdpDialog idp={dialog.idp} onClose={() => setDialog(null)} />
      )}
      {dialog?.mode === "delete" && (
        <DeleteIdpDialog idp={dialog.idp} onClose={() => setDialog(null)} />
      )}
      {dialog?.mode === "mapping" && (
        <MappingDialog idp={dialog.idp} editable={editable} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

/**
 * One IdP row plus its enterprise actions (ADR-0046): the brokered callback URL
 * (with copy), a non-interactive connection test with a classified result badge,
 * and — when editable — edit / mapping / delete. Secrets are never shown.
 */
function IdpRow({
  idp,
  editable,
  onEdit,
  onDelete,
  onMapping,
}: {
  idp: IdpSummary;
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMapping: () => void;
}) {
  const t = useTranslation();
  const [showCallback, setShowCallback] = useState(false);
  const callback = useIdpCallbackUrl(showCallback ? idp.alias : null);
  const test = useTestIdpConnection();
  const testResult = test.data?.result;

  return (
    <div
      className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
      data-testid={`auth-idp-row-${idp.alias}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-fg">{idp.displayName}</p>
          <p className="text-xs text-fg-muted">
            {idp.alias} · {idp.providerId} ·{" "}
            {idp.hasClientSecret
              ? t("feature.admin.auth.idps.secretSet")
              : t("feature.admin.auth.idps.noSecret")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={idp.enabled ? "default" : "secondary"}>
            {idp.enabled
              ? t("feature.admin.auth.idps.enabled")
              : t("feature.admin.auth.idps.disabled")}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onPress={() => setShowCallback((v) => !v)}
            data-testid={`auth-idp-callback-${idp.alias}`}
          >
            {t("feature.admin.auth.idps.callbackUrl")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            isDisabled={test.isPending}
            onPress={() => test.mutate(idp.alias)}
            data-testid={`auth-idp-test-${idp.alias}`}
          >
            {t("feature.admin.auth.idps.testConnection")}
          </Button>
          {editable && (
            <>
              <Button
                size="sm"
                variant="outline"
                onPress={onMapping}
                data-testid={`auth-idp-mapping-${idp.alias}`}
              >
                {t("feature.admin.auth.idps.mapping")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onPress={onEdit}
                data-testid={`auth-idp-edit-${idp.alias}`}
              >
                {t("feature.admin.auth.idps.edit")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onPress={onDelete}
                data-testid={`auth-idp-delete-${idp.alias}`}
              >
                {t("feature.admin.auth.idps.delete")}
              </Button>
            </>
          )}
        </div>
      </div>

      {showCallback && callback.data && (
        <div className="flex items-center gap-2 rounded-md border border-border p-2">
          <code
            className="flex-1 break-all text-xs text-fg-muted"
            data-testid={`auth-idp-callback-url-${idp.alias}`}
          >
            {callback.data.callbackUrl}
          </code>
          <Button
            size="sm"
            variant="outline"
            onPress={() => void navigator.clipboard?.writeText(callback.data!.callbackUrl)}
            data-testid={`auth-idp-callback-copy-${idp.alias}`}
          >
            {t("feature.admin.auth.idps.copy")}
          </Button>
        </div>
      )}

      <LiveRegion
        tone="polite"
        className="text-xs"
        data-testid={`auth-idp-test-result-${idp.alias}`}
      >
        {test.isPending
          ? t("auth.status.loading")
          : test.isError
            ? t("feature.admin.auth.idps.testError")
            : testResult
              ? t(`feature.admin.auth.idps.testResult.${testResult}`)
              : ""}
      </LiveRegion>
    </div>
  );
}

function providerItems(t: (k: string) => string): SelectItem[] {
  return IDP_PROVIDER_IDS.map((id) => ({
    id,
    label: t(`feature.admin.auth.idps.providerName.${id}`),
  }));
}

function CreateIdpDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslation();
  const create = useCreateIdp();
  const { control, handleSubmit, watch, setValue } = useForm<CreateIdpForm>({
    resolver: zodResolver(CreateIdpFormSchema),
    defaultValues: {
      alias: "",
      displayName: "",
      providerId: "oidc",
      clientId: "",
      clientSecret: "",
      issuer: "",
      authorizationUrl: "",
      tokenUrl: "",
      userInfoUrl: "",
      scopes: "",
      trustEmail: false,
    },
  });
  const providerId = watch("providerId");

  function onSubmit(v: CreateIdpForm) {
    const payload: CreateIdpRequest = {
      alias: v.alias,
      displayName: v.displayName,
      providerId: v.providerId,
      clientId: v.clientId,
      clientSecret: v.clientSecret,
      trustEmail: v.trustEmail,
      enabled: true,
      ...(v.issuer ? { issuer: v.issuer } : {}),
      ...(v.authorizationUrl ? { authorizationUrl: v.authorizationUrl } : {}),
      ...(v.tokenUrl ? { tokenUrl: v.tokenUrl } : {}),
      ...(v.userInfoUrl ? { userInfoUrl: v.userInfoUrl } : {}),
      ...(v.scopes ? { scopes: v.scopes } : {}),
    };
    create.mutate(payload, { onSuccess: onClose });
  }

  return (
    <Dialog
      isOpen
      onOpenChange={(o) => !o && onClose()}
      aria-label={t("feature.admin.auth.idps.add")}
    >
      <h2 className="text-base font-semibold text-fg">{t("feature.admin.auth.idps.add")}</h2>
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-4 space-y-3"
        data-testid="auth-idp-form"
      >
        <TextField control={control} name="alias" label={t("feature.admin.auth.idps.aliasLabel")} />
        <TextField
          control={control}
          name="displayName"
          label={t("feature.admin.auth.idps.displayNameLabel")}
        />
        <Controller
          control={control}
          name="providerId"
          render={({ field }) => (
            <div>
              <label id="idp-provider-label" className="mb-1 block text-sm font-medium text-fg">
                {t("feature.admin.auth.idps.providerIdLabel")}
              </label>
              <Select
                items={providerItems(t)}
                placeholder={t("feature.admin.auth.idps.providerIdLabel")}
                selectedKey={field.value}
                aria-labelledby="idp-provider-label"
                onSelectionChange={(k) => field.onChange(String(k))}
                data-testid="auth-idp-providerId"
              />
            </div>
          )}
        />
        <TextField
          control={control}
          name="clientId"
          label={t("feature.admin.auth.idps.clientIdLabel")}
        />
        <TextField
          control={control}
          name="clientSecret"
          type="password"
          label={t("feature.admin.auth.idps.clientSecretLabel")}
        />
        {providerId === "oidc" && (
          <>
            <DiscoveryImport
              onImported={(m) => {
                setValue("issuer", m.issuer, { shouldValidate: true });
                setValue("authorizationUrl", m.authorizationEndpoint, { shouldValidate: true });
                setValue("tokenUrl", m.tokenEndpoint, { shouldValidate: true });
                setValue("userInfoUrl", m.userInfoEndpoint ?? "", { shouldValidate: true });
              }}
            />
            <TextField
              control={control}
              name="authorizationUrl"
              label={t("feature.admin.auth.idps.authUrlLabel")}
            />
            <TextField
              control={control}
              name="tokenUrl"
              label={t("feature.admin.auth.idps.tokenUrlLabel")}
            />
          </>
        )}
        <TextField
          control={control}
          name="scopes"
          label={t("feature.admin.auth.idps.scopesLabel")}
        />
        <Controller
          control={control}
          name="trustEmail"
          render={({ field }) => (
            <Switch
              isSelected={field.value}
              onChange={field.onChange}
              data-testid="auth-idp-trustEmail"
            >
              {t("feature.admin.auth.idps.trustEmailLabel")}
            </Switch>
          )}
        />
        {create.isError && (
          <p role="alert" className="text-sm text-danger" data-testid="auth-idp-error">
            {t("feature.admin.auth.idps.createError")}
          </p>
        )}
        <DialogActions
          onClose={onClose}
          pending={create.isPending}
          submitLabel={t("feature.admin.auth.idps.create")}
          submitTestId="auth-idp-submit"
        />
      </form>
    </Dialog>
  );
}

function EditIdpDialog({ idp, onClose }: { idp: IdpSummary; onClose: () => void }) {
  const t = useTranslation();
  const update = useUpdateIdp();
  const { control, handleSubmit } = useForm<EditIdpForm>({
    resolver: zodResolver(EditIdpFormSchema),
    defaultValues: {
      displayName: idp.displayName,
      clientId: idp.clientId ?? "",
      clientSecret: "", // never prefilled — blank preserves the existing secret
      authorizationUrl: "",
      tokenUrl: "",
      scopes: idp.scopes ?? "",
      trustEmail: idp.trustEmail,
      enabled: idp.enabled,
    },
  });

  function onSubmit(v: EditIdpForm) {
    const input: UpdateIdpRequest = {
      displayName: v.displayName,
      clientId: v.clientId,
      trustEmail: v.trustEmail,
      enabled: v.enabled,
      ...(v.clientSecret ? { clientSecret: v.clientSecret } : {}),
      ...(v.authorizationUrl ? { authorizationUrl: v.authorizationUrl } : {}),
      ...(v.tokenUrl ? { tokenUrl: v.tokenUrl } : {}),
      ...(v.scopes ? { scopes: v.scopes } : {}),
    };
    update.mutate({ alias: idp.alias, input }, { onSuccess: onClose });
  }

  return (
    <Dialog
      isOpen
      onOpenChange={(o) => !o && onClose()}
      aria-label={`${t("feature.admin.auth.idps.edit")} ${idp.alias}`}
    >
      <h2 className="text-base font-semibold text-fg">
        {t("feature.admin.auth.idps.edit")} · {idp.alias}
      </h2>
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-4 space-y-3"
        data-testid="auth-idp-edit-form"
      >
        <TextField
          control={control}
          name="displayName"
          label={t("feature.admin.auth.idps.displayNameLabel")}
        />
        <TextField
          control={control}
          name="clientId"
          label={t("feature.admin.auth.idps.clientIdLabel")}
        />
        <TextField
          control={control}
          name="clientSecret"
          type="password"
          label={t("feature.admin.auth.idps.clientSecretLabel")}
          description={t("feature.admin.auth.idps.clientSecretEditHelper")}
        />
        <TextField
          control={control}
          name="scopes"
          label={t("feature.admin.auth.idps.scopesLabel")}
        />
        <Controller
          control={control}
          name="trustEmail"
          render={({ field }) => (
            <Switch
              isSelected={field.value}
              onChange={field.onChange}
              data-testid="auth-idp-edit-trustEmail"
            >
              {t("feature.admin.auth.idps.trustEmailLabel")}
            </Switch>
          )}
        />
        <Controller
          control={control}
          name="enabled"
          render={({ field }) => (
            <Switch
              isSelected={field.value}
              onChange={field.onChange}
              data-testid="auth-idp-edit-enabled"
            >
              {t("feature.admin.auth.idps.enabledLabel")}
            </Switch>
          )}
        />
        {update.isError && (
          <p role="alert" className="text-sm text-danger" data-testid="auth-idp-edit-error">
            {t("feature.admin.auth.idps.updateError")}
          </p>
        )}
        <DialogActions
          onClose={onClose}
          pending={update.isPending}
          submitLabel={t("feature.admin.auth.idps.save")}
          submitTestId="auth-idp-edit-submit"
        />
      </form>
    </Dialog>
  );
}

function DeleteIdpDialog({ idp, onClose }: { idp: IdpSummary; onClose: () => void }) {
  const t = useTranslation();
  const del = useDeleteIdp();
  return (
    <Dialog
      isOpen
      onOpenChange={(o) => !o && onClose()}
      aria-label={t("feature.admin.auth.idps.delete")}
    >
      <h2 className="text-base font-semibold text-fg">{t("feature.admin.auth.idps.delete")}</h2>
      <p className="mt-2 text-sm text-fg-muted" data-testid="auth-idp-delete-body">
        {t("feature.admin.auth.idps.deleteConfirm", { alias: idp.alias })}
      </p>
      {del.isError && (
        <p role="alert" className="mt-2 text-sm text-danger" data-testid="auth-idp-delete-error">
          {t("feature.admin.auth.idps.deleteError")}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" type="button" onPress={onClose}>
          {t("feature.admin.auth.idps.cancel")}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          isDisabled={del.isPending}
          onPress={() => del.mutate(idp.alias, { onSuccess: onClose })}
          data-testid="auth-idp-delete-confirm"
        >
          {t("feature.admin.auth.idps.delete")}
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * OIDC discovery import (ADR-0046). Paste an issuer; the BFF fetches + validates
 * the discovery document and JWKS, and on success the parent populates the URL
 * fields from the returned minimal metadata. No secret involved.
 */
function DiscoveryImport({ onImported }: { onImported: (m: OidcDiscoveryMetadata) => void }) {
  const t = useTranslation();
  const discover = useDiscoverOidc();
  const [issuer, setIssuer] = useState("");
  const result = discover.data?.validation.result;

  function run() {
    const value = issuer.trim();
    if (!value) return;
    discover.mutate(
      { issuer: value },
      {
        onSuccess: (r) => {
          if (r.metadata) onImported(r.metadata);
        },
      }
    );
  }

  return (
    <div className="rounded-md border border-border p-3" data-testid="auth-idp-discovery">
      <FormField
        label={t("feature.admin.auth.idps.discoveryLabel")}
        description={t("feature.admin.auth.idps.discoveryHelper")}
        value={issuer}
        onChange={setIssuer}
        inputProps={{ "data-testid": "auth-idp-discovery-issuer" }}
      />
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          type="button"
          isDisabled={discover.isPending || !issuer.trim()}
          onPress={run}
          data-testid="auth-idp-discovery-import"
        >
          {t("feature.admin.auth.idps.discoveryImport")}
        </Button>
        <LiveRegion tone="polite" className="text-xs" data-testid="auth-idp-discovery-status">
          {discover.isPending
            ? t("auth.status.loading")
            : discover.isError
              ? t("feature.admin.auth.idps.discoveryError")
              : result
                ? t(`feature.admin.auth.idps.testResult.${result}`)
                : ""}
        </LiveRegion>
      </div>
    </div>
  );
}

const MappingFormSchema = z.object({
  claimMappings: z.array(
    z.object({ upstreamClaim: z.string().min(1), userAttribute: z.string().min(1) })
  ),
  roleMappings: z.array(
    z.object({
      upstreamClaim: z.string().min(1),
      claimValue: z.string().min(1),
      realmRole: z.enum(TENANT_ROLES),
    })
  ),
});

/**
 * Claim + group/role mapping editor (ADR-0046). Full-replace semantics; role
 * targets are limited to the tenant roles. Read-only unless `editable`.
 */
function MappingDialog({
  idp,
  editable,
  onClose,
}: {
  idp: IdpSummary;
  editable: boolean;
  onClose: () => void;
}) {
  const t = useTranslation();
  const mapping = useIdpMapping(idp.alias);
  const update = useUpdateIdpMapping();
  const { control, handleSubmit } = useForm<IdpMappingConfig>({
    resolver: zodResolver(MappingFormSchema),
    values: mapping.data ?? { claimMappings: [], roleMappings: [] },
  });
  const claims = useFieldArray({ control, name: "claimMappings" });
  const roles = useFieldArray({ control, name: "roleMappings" });
  const roleItems: SelectItem[] = TENANT_ROLES.map((r) => ({ id: r, label: r }));

  function onSubmit(v: IdpMappingConfig) {
    update.mutate({ alias: idp.alias, input: v }, { onSuccess: onClose });
  }

  return (
    <Dialog
      isOpen
      onOpenChange={(o) => !o && onClose()}
      aria-label={`${t("feature.admin.auth.idps.mapping")} ${idp.alias}`}
    >
      <h2 className="text-base font-semibold text-fg">
        {t("feature.admin.auth.idps.mapping")} · {idp.alias}
      </h2>
      <p className="mt-1 text-xs text-fg-muted">{t("feature.admin.auth.idps.mappingHelper")}</p>
      {mapping.isLoading ? (
        <LoadingState message={t("auth.status.loading")} />
      ) : (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="mt-4 space-y-4"
          data-testid="auth-idp-mapping-form"
        >
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-fg">
              {t("feature.admin.auth.idps.claimMappings")}
            </h3>
            {claims.fields.map((f, i) => (
              <div key={f.id} className="flex items-end gap-2" data-testid={`auth-idp-claim-${i}`}>
                <TextField
                  control={control}
                  name={`claimMappings.${i}.upstreamClaim`}
                  label={t("feature.admin.auth.idps.upstreamClaim")}
                />
                <TextField
                  control={control}
                  name={`claimMappings.${i}.userAttribute`}
                  label={t("feature.admin.auth.idps.userAttribute")}
                />
                {editable && (
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onPress={() => claims.remove(i)}
                    data-testid={`auth-idp-claim-remove-${i}`}
                  >
                    {t("feature.admin.auth.idps.removeRow")}
                  </Button>
                )}
              </div>
            ))}
            {editable && (
              <Button
                size="sm"
                variant="outline"
                type="button"
                onPress={() => claims.append({ upstreamClaim: "", userAttribute: "" })}
                data-testid="auth-idp-claim-add"
              >
                {t("feature.admin.auth.idps.addClaimMapping")}
              </Button>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-medium text-fg">
              {t("feature.admin.auth.idps.roleMappings")}
            </h3>
            {roles.fields.map((f, i) => (
              <div key={f.id} className="flex items-end gap-2" data-testid={`auth-idp-role-${i}`}>
                <TextField
                  control={control}
                  name={`roleMappings.${i}.upstreamClaim`}
                  label={t("feature.admin.auth.idps.upstreamClaim")}
                />
                <TextField
                  control={control}
                  name={`roleMappings.${i}.claimValue`}
                  label={t("feature.admin.auth.idps.claimValue")}
                />
                <Controller
                  control={control}
                  name={`roleMappings.${i}.realmRole`}
                  render={({ field }) => (
                    <div>
                      <label
                        id={`role-label-${i}`}
                        className="mb-1 block text-sm font-medium text-fg"
                      >
                        {t("feature.admin.auth.idps.realmRole")}
                      </label>
                      <Select
                        items={roleItems}
                        placeholder={t("feature.admin.auth.idps.realmRole")}
                        selectedKey={field.value}
                        aria-labelledby={`role-label-${i}`}
                        onSelectionChange={(k) => field.onChange(String(k))}
                        data-testid={`auth-idp-role-select-${i}`}
                      />
                    </div>
                  )}
                />
                {editable && (
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onPress={() => roles.remove(i)}
                    data-testid={`auth-idp-role-remove-${i}`}
                  >
                    {t("feature.admin.auth.idps.removeRow")}
                  </Button>
                )}
              </div>
            ))}
            {editable && (
              <Button
                size="sm"
                variant="outline"
                type="button"
                onPress={() =>
                  roles.append({ upstreamClaim: "", claimValue: "", realmRole: "member" })
                }
                data-testid="auth-idp-role-add"
              >
                {t("feature.admin.auth.idps.addRoleMapping")}
              </Button>
            )}
          </section>

          {update.isError && (
            <p role="alert" className="text-sm text-danger" data-testid="auth-idp-mapping-error">
              {t("feature.admin.auth.idps.mappingError")}
            </p>
          )}
          {editable ? (
            <DialogActions
              onClose={onClose}
              pending={update.isPending}
              submitLabel={t("feature.admin.auth.idps.save")}
              submitTestId="auth-idp-mapping-submit"
            />
          ) : (
            <div className="flex justify-end pt-2">
              <Button variant="outline" size="sm" type="button" onPress={onClose}>
                {t("feature.admin.auth.idps.cancel")}
              </Button>
            </div>
          )}
        </form>
      )}
    </Dialog>
  );
}

// --- small shared form helpers ---------------------------------------------

function DialogActions({
  onClose,
  pending,
  submitLabel,
  submitTestId,
}: {
  onClose: () => void;
  pending: boolean;
  submitLabel: string;
  submitTestId: string;
}) {
  const t = useTranslation();
  return (
    <div className="flex items-center justify-end gap-2 pt-2">
      <LiveRegion tone="polite" className="sr-only">
        {pending ? t("auth.status.loading") : ""}
      </LiveRegion>
      <Button variant="outline" size="sm" type="button" onPress={onClose}>
        {t("feature.admin.auth.idps.cancel")}
      </Button>
      <Button size="sm" type="submit" isDisabled={pending} data-testid={submitTestId}>
        {submitLabel}
      </Button>
    </div>
  );
}

function TextField({
  control,
  name,
  label,
  type,
  description,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  name: string;
  label: string;
  type?: string;
  description?: string;
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
          isInvalid={!!fieldState.error}
          errorMessage={fieldState.error?.message}
          inputProps={{ "data-testid": `auth-idp-field-${name}` }}
        />
      )}
    />
  );
}
