// ---------------------------------------------------------------------------
// Event bus + worker-registry ports (ADR-0059 / ADR-ACT-0259).
//
// Built-in Postgres outbox today; Redis Streams / NATS are Phase-5.5 providers behind
// EventBusPort. Events are tenant-scoped (RLS) + idempotent by (org, type, key). The
// worker runtime claims pending events, dispatches to a handler, marks processed, or
// retries with backoff and dead-letters after max_attempts. Operators can redrive.
// No secret payload fields (rejected in the usecase).
// ---------------------------------------------------------------------------

export interface PublishEventInput {
  organisationId: string;
  eventType: string;
  idempotencyKey: string;
  payload?: Record<string, unknown> | undefined;
  maxAttempts?: number | undefined;
}

export interface ClaimedEvent {
  id: string;
  organisationId: string;
  eventType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export interface EventRow {
  id: string;
  organisationId: string;
  eventType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface DeadLetterRow {
  id: string;
  eventId: string;
  organisationId: string;
  eventType: string;
  attempts: number;
  lastError: string | null;
  deadAt: string;
  redrivenAt: string | null;
}

export interface EventBusPort {
  /** Idempotent publish. `deduplicated` = a row with the same (org, type, key) existed. */
  publish(input: PublishEventInput): Promise<{ published: boolean; deduplicated: boolean }>;
  /** Atomically claim up to `limit` due pending events (FOR UPDATE SKIP LOCKED). */
  claimBatch(limit: number): Promise<ClaimedEvent[]>;
  /** Mark a claimed event processed. */
  markProcessed(eventId: string): Promise<void>;
  /**
   * Record a handler failure: increments attempts, sets a backoff, and — when attempts
   * reach max_attempts — moves the event to the dead-letter table. Returns the outcome.
   */
  recordFailure(eventId: string, error: string): Promise<"retry" | "dead_lettered">;
  /** Operator list of events for a tenant (rls_bypass). */
  listEvents(organisationId: string, limit: number): Promise<EventRow[]>;
  /** Operator list of dead letters for a tenant (rls_bypass). */
  listDeadLetters(organisationId: string, limit: number): Promise<DeadLetterRow[]>;
  /** Re-enqueue a dead letter as a fresh pending event. Returns the new event id, or null. */
  redrive(deadLetterId: string): Promise<{ eventId: string } | null>;
}

export interface WorkerRecord {
  workerId: string;
  workerKind: string;
  status: string;
  lastHeartbeatAt: string;
}

export interface WorkerRegistryPort {
  heartbeat(workerId: string, workerKind: string, status?: string): Promise<void>;
  listWorkers(): Promise<WorkerRecord[]>;
}
