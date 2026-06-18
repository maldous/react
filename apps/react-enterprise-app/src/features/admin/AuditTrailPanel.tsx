import { LoadingState, EmptyState, Badge } from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import type { AuditResource } from "@platform/contracts-admin";
import { AdminQueryError } from "./AdminQueryError";
import { useAudit } from "./use-audit";

/**
 * Compact, read-only contextual audit panel (ADR-0040). Shows recent audit events for a
 * resource/resourceId — action, actor, and time — with the standard admin states. It is
 * refreshed by invalidating the ["admin","audit"] query prefix after a mutation.
 */
export function AuditTrailPanel({
  resource,
  resourceId,
  action,
  heading,
  testId,
  enabled = true,
}: {
  resource: AuditResource;
  resourceId?: string;
  /** Optional exact audit-action filter (e.g. "auth_settings.session.changed"). */
  action?: string;
  heading: string;
  testId: string;
  enabled?: boolean;
}) {
  const t = useTranslation();
  const { data, isLoading, isError, error } = useAudit({ resource, resourceId, action }, enabled);
  const events = data?.events ?? [];

  function renderBody() {
    if (isLoading) {
      return <LoadingState message={t("auth.status.loading")} />;
    }
    if (isError) {
      return <AdminQueryError error={error} />;
    }
    if (events.length === 0) {
      return <EmptyState title={t("feature.admin.audit.empty")} />;
    }
    return (
      <ul className="space-y-1 text-sm" data-testid={`${testId}-list`}>
        {events.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Badge variant="secondary">{e.action}</Badge>
            <span className="text-fg-muted">
              {t("feature.admin.audit.by", { actor: e.actorId })}
            </span>
            <time className="font-mono text-xs text-fg-muted" dateTime={e.timestamp}>
              {e.timestamp.slice(0, 19).replace("T", " ")}
            </time>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div data-testid={testId} role="group" aria-label={heading}>
      <p className="mb-2 text-sm font-semibold text-fg">{heading}</p>
      {renderBody()}
    </div>
  );
}
