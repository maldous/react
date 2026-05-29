import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  UpdateOrganisationProfileRequestSchema,
  type UpdateOrganisationProfileRequest,
} from "@platform/contracts-organisation";
import { LoadingState, ErrorState } from "@platform/ui-design-system";
import { useSession } from "../../hooks/use-session";
import { useOrganisationProfile } from "./use-organisation-profile";
import { useUpdateOrganisationProfile } from "./use-update-organisation-profile";
import { useTranslation } from "@platform/i18n-runtime";

export function OrganisationProfilePage() {
  const { actor, hasPermission } = useSession();
  const t = useTranslation();
  const { data: profile, isLoading, isError } = useOrganisationProfile();
  const mutation = useUpdateOrganisationProfile();
  const canEdit = hasPermission("organisation.update");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UpdateOrganisationProfileRequest>({
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
    <div className="p-8 max-w-xl" data-testid="organisation-profile">
      <h1 className="text-2xl font-semibold mb-6">{t("feature.organisation.profile.title")}</h1>

      {canEdit ? (
        <form onSubmit={handleSubmit(onSubmit)} data-testid="profile-edit-form">
          <label htmlFor="displayName" className="block text-sm font-medium mb-1">
            {t("feature.organisation.profile.form.displayName.label")}
          </label>
          <input
            id="displayName"
            className="border rounded px-3 py-2 w-full"
            {...register("displayName")}
            data-testid="display-name-input"
          />
          {errors.displayName && (
            <p className="text-red-600 text-sm mt-1">{errors.displayName.message}</p>
          )}
          <button
            type="submit"
            className="mt-3 px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
            disabled={mutation.isPending}
            data-testid="save-button"
          >
            {mutation.isPending ? t("auth.status.saving") : t("ui.action.save")}
          </button>
          {mutation.isSuccess && (
            <p className="text-green-600 mt-2" data-testid="success-message">
              {t("ui.error.profileUpdated")}
            </p>
          )}
          {mutation.isError && <p className="text-red-600 mt-2">{t("ui.error.saveFailed")}</p>}
        </form>
      ) : (
        <div data-testid="profile-read-only">
          <p className="text-sm text-gray-500 mb-1">
            {t("feature.organisation.profile.form.displayName.label")}
          </p>
          <p className="font-medium" data-testid="display-name-value">
            {profile.displayName}
          </p>
        </div>
      )}

      <div className="mt-6 text-sm text-gray-500 border-t pt-4">
        <p>
          {t("ui.label.slug")}: <span data-testid="org-slug">{profile.slug}</span>
        </p>
        {actor && <p>{t("ui.label.signedInAs", { name: actor.displayName })}</p>}
      </div>
    </div>
  );
}
