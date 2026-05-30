import { useQuery } from "@tanstack/react-query";
import { type SessionActor, type AuthErrorCode, AUTH_ERROR_CODE } from "@platform/contracts-auth";

export const sessionQueryKey = ["session"] as const;

/** Typed error for session fetch failures ? uses the platform auth error vocabulary. */
export class SessionFetchError extends Error {
  readonly code: AuthErrorCode = AUTH_ERROR_CODE.PROVIDER_ERROR;
  readonly status: number;

  constructor(status: number) {
    super(`Session unavailable (${status})`);
    this.name = "SessionFetchError";
    this.status = status;
  }
}

async function fetchSession(): Promise<SessionActor | null> {
  const res = await fetch("/api/session", { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new SessionFetchError(res.status);
  return res.json() as Promise<SessionActor>;
}

export function useSession() {
  const query = useQuery({
    queryKey: sessionQueryKey,
    queryFn: fetchSession,
    staleTime: 60_000,
    retry: false,
  });

  return {
    actor: query.data ?? null,
    isLoading: query.isLoading,
    isAuthenticated: query.data != null,
    hasPermission: (permission: string) => query.data?.permissions.includes(permission) ?? false,
    error: query.error instanceof SessionFetchError ? query.error : null,
  };
}
