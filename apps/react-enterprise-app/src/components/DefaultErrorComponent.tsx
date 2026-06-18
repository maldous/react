import { useRouter } from "@tanstack/react-router";
import { useTranslation } from "@platform/i18n-runtime";

export function DefaultErrorComponent({ error }: Readonly<{ error: Error }>) {
  const router = useRouter();
  const t = useTranslation();
  return (
    <main id="main-content" role="alert" style={{ padding: "2rem" }}>
      <h1>{t("ui.error.title")}</h1>
      <p>{error.message}</p>
      <button type="button" onClick={() => void router.invalidate()}>
        {t("ui.error.retry")}
      </button>
    </main>
  );
}
