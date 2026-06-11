// Classify a failed admin REST request (thrown by admin-fetch as AdminRequestError)
// so the UI can render the right state instead of a generic catch-all (ADR-0036).

export type AdminErrorKind = "unauthorized" | "forbidden" | "not_configured" | "error";

export function classifyAdminError(error: unknown): AdminErrorKind {
  const e = error as { status?: number; code?: string } | null | undefined;
  const status = e?.status;
  if (status === 401) return "unauthorized"; // session expired → re-login
  if (status === 403) return "forbidden"; // lacks permission → ForbiddenState
  // The credential-gated auth-settings endpoints (idps/mfa/session) return
  // 503 { code: "NO_CREDENTIAL" } when the tenant has no service account yet — an
  // expected "not configured" state. A bare 503 (real outage) stays a generic error.
  if (e?.code === "NO_CREDENTIAL") return "not_configured";
  return "error";
}
