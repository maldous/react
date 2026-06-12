import type { PlatformWorkerStatus } from "@platform/contracts-admin";

// ---------------------------------------------------------------------------
// Background worker heartbeat registry (ADR-ACT-0228).
//
// A minimal in-memory heartbeat so the operations cockpit can show background-worker
// liveness. It is process-local and RESETS ON RESTART (surfaced via `inMemory: true`
// in the API) — no persistent store. Records only safe metadata: a timestamp, a status,
// and a short non-secret error summary.
// ---------------------------------------------------------------------------

export interface WorkerHeartbeat {
  lastTickAt: string | null;
  lastError: string | null;
  status: PlatformWorkerStatus;
}

const heartbeats = new Map<string, WorkerHeartbeat>();

/** Record the outcome of a worker tick. `error` is truncated + never expected to hold a secret. */
export function recordWorkerTick(key: string, ok: boolean, error?: string): void {
  heartbeats.set(key, {
    lastTickAt: new Date().toISOString(),
    lastError: ok ? null : (error ?? "tick failed").slice(0, 200),
    status: ok ? "idle" : "error",
  });
}

/** Mark a worker as started/stopped (status before any tick). */
export function setWorkerStatus(key: string, status: PlatformWorkerStatus): void {
  const existing = heartbeats.get(key);
  heartbeats.set(key, {
    lastTickAt: existing?.lastTickAt ?? null,
    lastError: existing?.lastError ?? null,
    status,
  });
}

export function getWorkerHeartbeat(key: string): WorkerHeartbeat | null {
  return heartbeats.get(key) ?? null;
}
