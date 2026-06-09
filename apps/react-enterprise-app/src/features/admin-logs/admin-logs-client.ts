// Admin log search client (ADR-0035, ADR-ACT-0195).
// Talks to the BFF GET /api/admin/logs/search over fetch. Types are declared
// locally because the SPA must not import @platform/adapters-loki (Node adapter,
// forbidden in the browser per ADR-0022).

export interface LogSearchFilters {
  service?: string;
  level?: string;
  requestId?: string;
  traceId?: string;
  tenantId?: string;
  actorId?: string;
  organisationId?: string;
  text?: string;
  start?: string;
  end?: string;
  limit?: number;
}

export interface LogEntry {
  timestamp: string;
  line: string;
  fields: Record<string, unknown>;
  labels: Record<string, string>;
}

export interface LogSearchResult {
  entries: LogEntry[];
}

interface RequestError extends Error {
  code?: string;
  status?: number;
}

export async function searchLogs(filters: LogSearchFilters): Promise<LogSearchResult> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && String(value).trim().length > 0) {
      params.set(key, String(value));
    }
  }
  const res = await fetch(`/api/admin/logs/search?${params.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ code: "UNKNOWN" }))) as {
      message?: string;
      code?: string;
    };
    const e: RequestError = Object.assign(new Error(err.message ?? err.code ?? "UNKNOWN"), {
      code: err.code,
      status: res.status,
    });
    throw e;
  }
  return res.json() as Promise<LogSearchResult>;
}
