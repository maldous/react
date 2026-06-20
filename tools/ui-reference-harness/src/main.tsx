// Harness entry — wires the deterministic selection protocol to MSW + the generic app.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import model from "../../../docs/v2-foundation/ui-capability-model.json";
import { selectCapability } from "./load-capability.mjs";
import { getHarness, parseSelection } from "./capability-controller.mjs";
import { buildHandlers } from "./msw/handlers.mjs";
import { startWorker } from "./msw/browser";
import { App } from "./app";

async function boot() {
  const selection = parseSelection(window.location.search);
  const capability = selection.capability ? selectCapability(model, selection.capability) : null;
  const harness = getHarness(capability);

  if (harness) {
    await startWorker(buildHandlers(harness, { state: selection.state }));
  }

  const root = createRoot(document.getElementById("root")!);
  root.render(
    <StrictMode>
      <App capability={capability} selection={selection} />
    </StrictMode>
  );
}

void boot();
