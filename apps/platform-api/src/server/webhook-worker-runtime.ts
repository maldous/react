import { createLogger } from "@platform/platform-logging";
import { getApplicationPool } from "./dependencies.ts";
import { PostgresWebhookStore } from "../adapters/postgres-webhook-store.ts";
import { HttpWebhookDispatcher } from "../adapters/http-webhook-dispatcher.ts";
import { processDueDeliveries } from "../usecases/webhook-worker.ts";
import { recordWorkerTick, setWorkerStatus } from "./worker-registry.ts";

const log = createLogger({ name: "webhook-worker" });

/** Registry key for the webhook delivery worker (surfaced in the ops cockpit). */
export const WEBHOOK_WORKER_KEY = "webhook-delivery";

// ---------------------------------------------------------------------------
// Webhook delivery worker scheduler (ADR-0052). Started from the server bootstrap
// only (never on module import, so tests/substrate are unaffected). Each tick is
// best-effort: errors are logged, never thrown, so the loop survives a bad tick.
// Disable with WEBHOOK_WORKER_DISABLED=true.
// ---------------------------------------------------------------------------

const INTERVAL_MS = Number(process.env["WEBHOOK_WORKER_INTERVAL_MS"] ?? 5000);

/** Start the background delivery worker. Returns a stop function. */
export function startWebhookDeliveryWorker(): () => void {
  if (process.env["WEBHOOK_WORKER_DISABLED"] === "true") {
    log.info("webhook delivery worker disabled (WEBHOOK_WORKER_DISABLED=true)");
    return () => {};
  }

  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      const pool = getApplicationPool();
      const summary = await processDueDeliveries({
        store: new PostgresWebhookStore(pool),
        dispatch: new HttpWebhookDispatcher(),
      });
      if (summary.claimed > 0) {
        log.info(summary, "webhook delivery tick");
      }
      recordWorkerTick(WEBHOOK_WORKER_KEY, true);
    } catch (err) {
      log.error({ err }, "webhook delivery tick failed");
      recordWorkerTick(
        WEBHOOK_WORKER_KEY,
        false,
        err instanceof Error ? err.message : "tick failed"
      );
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref(); // don't keep the process alive
  setWorkerStatus(WEBHOOK_WORKER_KEY, "idle");
  log.info({ intervalMs: INTERVAL_MS }, "webhook delivery worker started");
  return () => {
    clearInterval(timer);
    setWorkerStatus(WEBHOOK_WORKER_KEY, "stopped");
  };
}
