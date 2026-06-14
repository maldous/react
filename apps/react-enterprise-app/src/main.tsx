import "./styles/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Toaster } from "@platform/ui-design-system";
import { I18nProvider, enGB } from "@platform/i18n-runtime";
import { queryClient } from "./app/query-client";
import { router } from "./app/router";
import { ThemeProvider } from "./theme/ThemeProvider";
import { initFaro } from "./observability/faro";

// Browser-side diagnostics (ADR-0074). Initialise BEFORE React renders so the
// earliest errors / Web Vitals of this page load are captured. No-op when disabled.
initFaro();

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider locale="en-GB" messages={enGB}>
          <RouterProvider router={router} />
          <Toaster />
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
);
