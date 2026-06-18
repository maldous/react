import { ErrorState, ForbiddenState, EmptyState } from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import { classifyAdminError } from "./admin-error";

/**
 * Renders the right state for a failed admin query (ADR-0036): 401 → session-expired
 * with a sign-in action; 403 → ForbiddenState; 503/NO_CREDENTIAL → "not configured";
 * anything else → a generic, retryable error. Avoids treating every failure as an
 * empty/generic state.
 */
export function AdminQueryError({
  error,
  onRetry,
}: Readonly<{ error: unknown; onRetry?: () => void }>) {
  const t = useTranslation();
  const kind = classifyAdminError(error);

  function renderState() {
    if (kind === "unauthorized") {
      return (
        <EmptyState
          title={t("feature.admin.error.sessionExpired")}
          description={t("feature.admin.error.signInAgain")}
          action={
            <a
              href="/login"
              data-testid="admin-error-signin"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {t("auth.login.signInButton")}
            </a>
          }
        />
      );
    }
    if (kind === "forbidden") {
      return (
        <ForbiddenState
          title={t("ui.accessDenied.title")}
          description={t("feature.admin.error.forbidden")}
        />
      );
    }
    if (kind === "not_configured") {
      return <EmptyState title={t("feature.admin.auth.notConfigured")} />;
    }
    return (
      <ErrorState
        title={t("feature.admin.error.generic")}
        {...(onRetry ? { onRetry, retryLabel: t("ui.error.retry") } : {})}
      />
    );
  }

  return <div data-testid={`admin-error-${kind}`}>{renderState()}</div>;
}
