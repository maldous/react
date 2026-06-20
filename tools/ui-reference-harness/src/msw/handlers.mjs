// Semantic Reference Harness — MSW handler builder (pure; consumed by browser + node setups).
//
// Handlers are generated from the capability's declared harness contract (queries/commands) and
// its fixtures — there is no hand-written per-capability mocking. The active data-state selects
// which fixture a read returns; mutations succeed unless the submitted body trips a declared
// server-validation trigger, mirroring how the real BFF rejects invalid input.
import { http, HttpResponse } from "msw";
import { pickFixture } from "../capability-controller.mjs";

const json = (status, body) => HttpResponse.json(body ?? {}, { status });

function readResponse(harness, state) {
  const fx =
    pickFixture(harness, state, "GET") ||
    pickFixture(harness, state === "degraded" ? "degraded" : "loaded", "GET");
  if (!fx) return json(200, {});
  return json(fx.status || 200, fx.body);
}

// A fixture trips when the submitted body either has a scalar field === triggerValue (per-row CRUD)
// or, for full-replace config payloads, when the serialised body contains triggerContains.
function bodyTrips(fixture, body) {
  if (!fixture || !body) return false;
  if (fixture.triggerField) return body[fixture.triggerField] === fixture.triggerValue;
  if (fixture.triggerContains) return JSON.stringify(body).includes(fixture.triggerContains);
  return false;
}

function mutationResponse(harness, command, body) {
  // Declared server-validation trigger (e.g. a name the BFF reports as a conflict) → 422.
  const invalid = pickFixture(harness, "validationError", command.method);
  if (bodyTrips(invalid, body)) return json(invalid.status || 422, invalid.body);

  const fail = pickFixture(harness, "serverError", command.method);
  if (bodyTrips(fail, body)) return json(fail.status || 500, fail.body);

  const ok = pickFixture(harness, command.resultingState || "success", command.method);
  if (ok) return json(ok.status || 200, ok.body);
  return command.method === "DELETE" ? new HttpResponse(null, { status: 204 }) : json(200, {});
}

/** Build the MSW handler list for one capability at a given data-state. */
export function buildHandlers(harness, { state = "loaded" } = {}) {
  const handlers = [];
  for (const q of harness.queries || []) {
    const method = (q.method || "GET").toLowerCase();
    handlers.push(http[method](q.endpoint, () => readResponse(harness, state)));
  }
  for (const c of harness.commands || []) {
    const method = (c.method || "POST").toLowerCase();
    handlers.push(
      http[method](c.endpoint, async ({ request }) => {
        let body = null;
        try {
          body = c.method === "DELETE" ? null : await request.json();
        } catch {
          body = null;
        }
        return mutationResponse(harness, c, body);
      })
    );
  }
  return handlers;
}
