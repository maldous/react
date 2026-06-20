// MSW browser worker for the harness. Handlers are built per-capability/per-state at boot.
import { setupWorker } from "msw/browser";
import type { RequestHandler } from "msw";

export function startWorker(handlers: RequestHandler[]) {
  const worker = setupWorker(...handlers);
  return worker.start({ onUnhandledRequest: "bypass", quiet: true });
}
