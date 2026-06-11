// ---------------------------------------------------------------------------
// Realm write-error classification (ADR-0041)
//
// The readiness probe classifies by HTTP status at the source. On a WRITE, the
// adapter has already thrown an Error by the time we see the failure, so the
// only signal left is its message. KeycloakRealmAdminAdapter throws stable,
// non-localised strings:
//   - token grant : "Keycloak admin token fetch failed: <status>"
//   - admin call   : "<op>: Keycloak admin request failed: <status> <body>"
//   - transport    : a fetch/network TypeError ("fetch failed", ECONNREFUSED, …)
// We map those to the same readiness vocabulary used everywhere else. Anything
// we cannot confidently classify stays "unknown" and is rethrown as a 500 — we
// never invent a friendlier status than the failure warrants.
// ---------------------------------------------------------------------------

export type RealmWriteError =
  | "invalid_credential"
  | "forbidden_realm_operation"
  | "realm_unreachable"
  | "conflict"
  | "not_found"
  | "unknown";

export function classifyRealmError(err: unknown): RealmWriteError {
  const msg = err instanceof Error ? err.message : String(err);
  const status = /failed: (\d{3})/.exec(msg)?.[1];
  if (status === "400" || status === "401") return "invalid_credential";
  if (status === "403") return "forbidden_realm_operation";
  // 404 = the targeted realm resource does not exist (e.g. unknown IdP alias).
  if (status === "404") return "not_found";
  // 409 = the realm already has a resource with this identifier (e.g. IdP alias).
  if (status === "409") return "conflict";
  if (status && Number(status) >= 500) return "realm_unreachable";
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|network|socket/i.test(msg)) {
    return "realm_unreachable";
  }
  return "unknown";
}
