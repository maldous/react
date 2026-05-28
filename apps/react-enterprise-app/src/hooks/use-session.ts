import { useQuery } from "@tanstack/react-query";
import type { SessionActor } from "@platform/contracts-auth";

export const sessionQueryKey = ["session"] as const;

async function fetchSession(): Promise<SessionActor | null> {
  const res = await fetch("/api/session", { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Session fetch failed: ${res.status}`);
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
  };
}
