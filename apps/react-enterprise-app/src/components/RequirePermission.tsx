import { type ReactNode } from "react";
import { ForbiddenState } from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import { useSession } from "../hooks/use-session";

export interface RequirePermissionProps {
  permission: string;
  children: ReactNode;
}

/**
 * Per-route permission gate (ADR-0021). Used inside routes rendered under the
 * `_authenticated` layout, which has already enforced authentication — so this
 * only checks the specific permission and renders the accessible ForbiddenState
 * when it is missing. Pair with {@link AuthenticatedLayout}; do not duplicate the
 * authentication checks here.
 */
export function RequirePermission({ permission, children }: RequirePermissionProps) {
  const { hasPermission } = useSession();
  const t = useTranslation();

  if (!hasPermission(permission)) {
    return (
      <ForbiddenState
        title={t("ui.accessDenied.title")}
        description={t("ui.accessDenied.description", { permission })}
      />
    );
  }
  return <>{children}</>;
}
