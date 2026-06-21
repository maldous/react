// ---------------------------------------------------------------------------
// Retention tick worker runtime (ADR-0064 / V1C-12b, decisionRef V1C-12b).
//
// Mirrors the webhook-worker-runtime pattern (ADR-0052). Started from the server
// bootstrap only \u2014 NEVER on module import, so tests / Tilt / substrate are
// unaffected. Each per-tenant tick is best-effort: errors are logged, never
// thrown, so one org's failure does not stop the loop.
//
// Cross-instance concurrency is enforced by `selectCandidates` returning rows
// with `FOR UPDATE SKIP LOCKED` so two BFF instances behind a load balancer
// safely partition the candidate pool instead of double-processing.
//
// Disable with V1C-12b_RETENTION_TICK_DISABLED=true.
// ---------------------------------------------------------------------------
import { createLogger } from "@platform/platform-logging";
import { createPostgresAuditEventPort } from "@platform/audit-events";
import { getApplicationPool } from "./dependencies.ts";
import { PostgresRetentionRepository } from "../adapters/postgres-retention.ts";
import { PostgresLegalHoldRepository } from "../adapters/postgres-legal-hold.ts";
import { runRetentionTick, type RetentionActor } from "../usecases/retention.ts";
import { recordWorkerTick, setWorkerStatus } from "./worker-registry.ts";

const log = createLogger({ name: "retention-worker" });

/** Registry key for the retention tick worker (surfaced in the ops cockpit). */
export const RETENTION_TICK_WORKER_KEY = "retention-tick";

/**
 * The retention tick is invoked by the platform scheduler \u2014 there is no human
 * caller. Locking the actor id down prevents impersonation in audit logs.
 */
export const V1C12B_SCHEDULER_ACTOR: RetentionActor = {
  actorId: "urn:platform:scheduler:retention-tick",
  actorRoles: ["system_operator"],
  sourceHost: "platform-retention-worker",
};

const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes per ADR-0064 (configurable via env)
const ENV_DISABLED = process.env["V1C12B_RETENTION_TICK_DISABLED"] === "true";

/**
 * Start the background retention tick worker. Returns a stop function so the
 * server bootstrap can wire SIGTERM/SIGINT cleanup uniformly with the webhook
 * worker.
 */
export function startRetentionTickWorker(): () => void {
  if (ENV_DISABLED) {
    log.info("retention tick worker disabled (V1C12B_RETENTION_TICK_DISABLED=true)");
    return () => {};
  }

  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return; // never overlap ticks within a single BFF
    running = true;
    try {
      const pool = getApplicationPool();
      const repository = new PostgresRetentionRepository(pool);
      // Cross-tenant enumeration: list the orgs that have any enabled retention
      // policy this round. This bounds the loop to active tenants (without a
      // tenant-registry port) and skips orgs with no enabled policies.
      const tenants = await repository.listEnabledTenants();
      log.info({ tenants: tenants.length }, "retention tick worker round");
      let successfulOrgs = 0;
      let failedOrgs = 0;
      // Per-org try/catch keeps a single tenant's failure from aborting the loop.
      for (const organisationId of tenants) {
        try {
          const result = await runRetentionTick(
            { organisationId, actor: V1C12B_SCHEDULER_ACTOR, candidateLimit: 200 },
            {
              repository,
              audit: createPostgresAuditEventPort(pool),
              guard: {
                repository: new PostgresLegalHoldRepository(pool),
              },
            }
          );
          successfulOrgs++;
          if (result.candidatesFound > 0) {
            log.info({ organisationId, ...result }, "retention tick summary for tenant");
          }
        } catch (err) {
          failedOrgs++;
          log.error({ err, organisationId }, "tenant retention tick failed; continuing the loop");
        }
      }
      recordWorkerTick(
        RETENTION_TICK_WORKER_KEY,
        failedOrgs === 0,
        failedOrgs > 0 ? `${failedOrgs} tenants failed` : undefined
      );
      log.info(
        { tenants: tenants.length, successfulOrgs, failedOrgs },
        "retention tick worker round complete"
      );
    } catch (err) {
      log.error({ err }, "retention tick worker outer loop failed");
      recordWorkerTick(
        RETENTION_TICK_WORKER_KEY,
        false,
        err instanceof Error ? err.message : "tick loop failed"
      );
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  setWorkerStatus(RETENTION_TICK_WORKER_KEY, "idle");
  log.info({ intervalMs: INTERVAL_MS }, "retention tick worker started");
  return () => {
    clearInterval(timer);
    setWorkerStatus(RETENTION_TICK_WORKER_KEY, "stopped");
  };
}
