import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  UpdateOrganisationProfileRequestSchema,
  type UpdateOrganisationProfileRequest,
} from "@platform/contracts-organisation";
import {
  Button,
  Card,
  CardBody,
  FormField,
  LiveRegion,
  LoadingState,
  ErrorState,
  SectionHeader,
} from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import { useSession } from "../../hooks/use-session";
import { useOrganisationProfile } from "./organisation.queries";
import { useUpdateOrganisationProfile } from "./organisation.mutations";

/**
 * Organisation profile — the canonical UI feature reference (ADR-ACT-0008,
 * ADR-ACT-0203). A dumb page: it composes feature hooks (which own the GraphQL
 * client + generated documents) with design-system primitives and token styling.
 * No GraphQL, no fetch, no `<main>` (the AppShell layout owns it), no hardcoded
 * colours, i18n-only text. Permission-gated: editing requires organisation.update.
 */
export function OrganisationProfilePage() {
  const { actor, hasPermission } = useSession();
  const t = useTranslation();
  const { data: profile, isLoading, isError } = useOrganisationProfile();
  const mutation = useUpdateOrganisationProfile();
  const canEdit = hasPermission("organisation.update");

  const { control, handleSubmit } = useForm<UpdateOrganisationProfileRequest>({
    resolver: zodResolver(UpdateOrganisationProfileRequestSchema),
    values: profile ? { displayName: profile.displayName } : undefined,
  });

  if (isLoading) return <LoadingState message={t("auth.status.loading")} />;
  if (isError)
    return (
      <ErrorState
        title={t("ui.error.loadProfileTitle")}
        description={t("ui.error.loadProfileDescription")}
      />
    );
  if (!profile) return null;

  const onSubmit = (data: UpdateOrganisationProfileRequest) => mutation.mutate(data);

  return (
    <section className="max-w-xl" data-testid="organisation-profile">
      <SectionHeader heading={t("feature.organisation.profile.title")} level={1} className="mb-6" />

      <Card>
        <CardBody className="space-y-4">
          {canEdit ? (
            <form onSubmit={handleSubmit(onSubmit)} data-testid="profile-edit-form" noValidate>
              <Controller
                name="displayName"
                control={control}
                render={({ field, fieldState }) => (
                  <FormField
                    label={t("feature.organisation.profile.form.displayName.label")}
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    isInvalid={!!fieldState.error}
                    errorMessage={fieldState.error?.message}
                    inputProps={{
                      "data-testid": "display-name-input",
                      autoComplete: "organization",
                    }}
                  />
                )}
              />

              <div className="mt-4 flex items-center gap-3">
                <Button type="submit" isDisabled={mutation.isPending} data-testid="save-button">
                  {mutation.isPending ? t("auth.status.saving") : t("ui.action.save")}
                </Button>
              </div>

              <LiveRegion tone="polite" className="mt-2 text-success" data-testid="success-message">
                {mutation.isSuccess && t("ui.success.profileUpdated")}
              </LiveRegion>
              <LiveRegion tone="assertive" className="text-danger">
                {mutation.isError && t("ui.error.saveFailed")}
              </LiveRegion>
            </form>
          ) : (
            <div data-testid="profile-read-only">
              <p className="text-sm text-fg-muted">
                {t("feature.organisation.profile.form.displayName.label")}
              </p>
              <p className="font-medium text-fg" data-testid="display-name-value">
                {profile.displayName}
              </p>
            </div>
          )}

          <div className="border-t border-border pt-4 text-sm text-fg-muted">
            <p>
              {t("ui.label.slug")}: <span data-testid="org-slug">{profile.slug}</span>
            </p>
            {actor && <p>{t("ui.label.signedInAs", { name: actor.displayName })}</p>}
          </div>
        </CardBody>
      </Card>
    </section>
  );
}
