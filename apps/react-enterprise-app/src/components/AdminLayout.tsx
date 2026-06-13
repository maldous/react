import { Link, Outlet } from "@tanstack/react-router";
import { SectionHeader } from "@platform/ui-design-system";
import { useTranslation } from "@platform/i18n-runtime";
import { useSession } from "../hooks/use-session";

/**
 * Tenant administration shell (ADR-0036). Renders the admin navigation and an
 * `<Outlet/>` for the active section. It lives INSIDE the AppShell's single
 * `<main id="main-content">` (owned by AuthenticatedLayout), so it adds no second
 * landmark — just a labelled `<nav>` and a content region.
 *
 * Responsive (ADR-0027 / Capacitor): a left sidebar on `lg+`, a horizontally
 * scrollable nav row on small screens. Links are real anchors (keyboard + touch
 * friendly, no hover-only affordances); the active item is styled via TanStack's
 * `data-status="active"`.
 */
export interface AdminNavItem {
  /** Target path. */
  to: string;
  /** i18n key for the label. */
  labelKey: string;
  /** Permission required to see this item (the route also enforces it). */
  permission: string;
  /** Exact-match active highlighting (the overview item). */
  exact?: boolean;
}

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  {
    to: "/admin",
    labelKey: "feature.admin.nav.overview",
    permission: "tenant.admin.access",
    exact: true,
  },
  {
    to: "/admin/readiness",
    labelKey: "feature.admin.nav.readiness",
    permission: "tenant.admin.access",
  },
  {
    to: "/admin/members",
    labelKey: "feature.admin.nav.members",
    permission: "tenant.members.read",
  },
  {
    to: "/admin/auth",
    labelKey: "feature.admin.nav.authentication",
    permission: "tenant.auth.settings.read",
  },
  {
    to: "/admin/features",
    labelKey: "feature.admin.nav.features",
    permission: "tenant.features.read",
  },
  {
    to: "/admin/config",
    labelKey: "feature.admin.nav.configuration",
    permission: "tenant.config.read",
  },
  {
    to: "/admin/email",
    labelKey: "feature.admin.nav.email",
    permission: "tenant.email.settings.read",
  },
  {
    to: "/admin/domains",
    labelKey: "feature.admin.nav.domains",
    permission: "tenant.domains.read",
  },
  {
    to: "/admin/storage",
    labelKey: "feature.admin.nav.storage",
    permission: "tenant.storage.read",
  },
  {
    to: "/admin/observability",
    labelKey: "feature.admin.nav.observability",
    permission: "tenant.observability.read",
  },
  {
    to: "/admin/webhooks",
    labelKey: "feature.admin.nav.webhooks",
    permission: "tenant.webhooks.read",
  },
  {
    to: "/admin/platform",
    labelKey: "feature.admin.nav.platform",
    permission: "tenant.platform.read",
  },
  { to: "/admin/logs", labelKey: "feature.admin.nav.logs", permission: "platform.logs.read" },
  {
    to: "/admin/entitlements",
    labelKey: "feature.admin.nav.entitlements",
    permission: "tenant.entitlements.read",
  },
  {
    to: "/admin/usage",
    labelKey: "feature.admin.nav.usage",
    permission: "tenant.metering.read",
  },
  {
    to: "/admin/developer",
    labelKey: "feature.admin.nav.developer",
    permission: "tenant.developer.read",
  },
  {
    to: "/admin/search",
    labelKey: "feature.admin.nav.search",
    permission: "tenant.search.read",
  },
  {
    to: "/admin/events",
    labelKey: "feature.admin.nav.events",
    permission: "platform.events.read",
  },
  {
    to: "/admin/account",
    labelKey: "feature.admin.nav.account",
    permission: "profile.read_self",
  },
  {
    to: "/admin/monitoring",
    labelKey: "feature.admin.nav.monitoring",
    permission: "platform.observability.read",
  },
];

const linkClass =
  "block rounded-md px-3 py-2 text-sm font-medium text-fg-muted no-underline transition-colors " +
  "hover:bg-surface-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-primary data-[status=active]:bg-primary/10 data-[status=active]:text-primary " +
  "whitespace-nowrap";

export function AdminLayout() {
  const t = useTranslation();
  const { hasPermission } = useSession();
  const items = ADMIN_NAV_ITEMS.filter((i) => hasPermission(i.permission));

  return (
    <div className="lg:grid lg:grid-cols-[14rem_1fr] lg:gap-8" data-testid="admin-layout">
      <nav
        aria-label={t("feature.admin.navLabel")}
        className="mb-6 lg:mb-0"
        data-testid="admin-nav"
      >
        <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          {t("feature.admin.title")}
        </p>
        {/* Mobile: horizontal scroll row; desktop: vertical sidebar. */}
        <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
          {items.map((item) => (
            <li key={item.to} className="shrink-0">
              <Link
                to={item.to}
                activeOptions={{ exact: item.exact ?? false }}
                className={linkClass}
                data-testid={`admin-nav-${item.to.split("/").pop() || "overview"}`}
              >
                {t(item.labelKey)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div data-testid="admin-content">
        <Outlet />
      </div>
    </div>
  );
}

/** Shared page header for admin sections (page-level h1). */
export function AdminSectionHeader({
  heading,
  description,
  action,
}: {
  heading: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <SectionHeader
      level={1}
      heading={heading}
      description={description}
      action={action}
      className="mb-6"
    />
  );
}
