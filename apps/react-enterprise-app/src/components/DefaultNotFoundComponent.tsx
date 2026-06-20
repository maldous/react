import { useTranslation } from "@platform/i18n-runtime";

export function DefaultNotFoundComponent() {
  const t = useTranslation();
  return (
    <main id="main-content" style={{ padding: "2rem" }}>
      <h1>{t("app.shell.pageNotFound")}</h1>
    </main>
  );
}
