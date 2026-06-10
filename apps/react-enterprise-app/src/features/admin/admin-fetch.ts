// Shared REST helpers for the tenant admin control plane (ADR-0036).
// Admin management endpoints are the supplementary BFF REST surface (ADR-0013);
// they go through the BFF over fetch with credentials, exactly like admin-logs.
// The SPA never bypasses the BFF and never imports server/adapter packages.

export interface AdminRequestError extends Error {
  code?: string;
  status?: number;
}

async function parseError(res: Response): Promise<AdminRequestError> {
  const body = (await res.json().catch(() => ({ code: "UNKNOWN" }))) as {
    message?: string;
    code?: string;
  };
  return Object.assign(new Error(body.message ?? body.code ?? "UNKNOWN"), {
    code: body.code,
    status: res.status,
  });
}

export async function adminGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<T>;
}

export async function adminSend<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw await parseError(res);
  // 204 / empty body tolerated.
  return res.json().catch(() => ({})) as Promise<T>;
}
