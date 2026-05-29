import { createRoute } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";
import { useTranslation } from "@platform/i18n-runtime";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: IndexComponent,
});

function IndexComponent() {
  const t = useTranslation();
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">{t("appTitle")}</h1>
      <p className="text-gray-600 mt-2">{t("appSubtitle")}</p>
    </div>
  );
}
