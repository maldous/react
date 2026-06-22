import { finding } from "../vocab.mjs";
import {
  VALID_EVENT_CATEGORIES,
  hasRealSourceReference,
  isFixtureEventName,
  present,
  proofExists,
} from "./quality.mjs";

export default function r26EventSemantics(ctx) {
  const out = [];
  const doc = ctx.foundation?.["event-semantics.json"];
  if (!doc || !Array.isArray(doc.events)) {
    return [finding("R26-event-semantics", "event-semantics.json", "missing event semantics")];
  }
  const events = new Map(doc.events.map((event) => [event.eventName, event]));
  for (const eventName of ctx.platformEventNames || []) {
    if (!events.has(eventName))
      out.push(
        finding(
          "R26-event-semantics",
          eventName,
          "event is emitted in code but absent from event-semantics"
        )
      );
  }
  for (const event of doc.events) {
    const subject = event.eventName || "<event>";
    const testOnly = event.category === "test-only" || event.excludedFromProductReadiness === true;
    if (!VALID_EVENT_CATEGORIES.has(event.category))
      out.push(finding("R26-event-semantics", subject, "event has no valid category"));
    if (isFixtureEventName(subject) && !testOnly)
      out.push(
        finding(
          "R26-event-semantics",
          subject,
          "fixture-like event name must be classified as test-only or fixture"
        )
      );
    if (testOnly && event.excludedFromProductReadiness !== true)
      out.push(
        finding("R26-event-semantics", subject, "test-only event is counted in readiness semantics")
      );
    if (!present(event.owner))
      out.push(finding("R26-event-semantics", subject, "event has no owner"));
    if (
      !present(event.schema) ||
      !present(event.version) ||
      !present(event.schemaVersion || event.schema?.schemaVersion || event.schema?.version)
    )
      out.push(finding("R26-event-semantics", subject, "event schema is unversioned"));
    if (
      event.schema?.additionalProperties === true &&
      !present(event.schema?.arbitraryPayloadJustification)
    )
      out.push(
        finding(
          "R26-event-semantics",
          subject,
          "event schema allows arbitrary payload without justification"
        )
      );
    if (present(event.consumers) && (!present(event.retryPolicy) || !present(event.dlqPolicy)))
      out.push(
        finding("R26-event-semantics", subject, "event has consumers but no retry/DLQ policy")
      );
    if (event.mutatingEvent !== false && !present(event.idempotencyKey))
      out.push(
        finding("R26-event-semantics", subject, "mutating event lacks idempotency semantics")
      );
    for (const field of [
      "producer",
      "payloadContract",
      "orderingExpectation",
      "retention",
      "privacyClassification",
      "tenantIsolation",
      "auditRelationship",
      "sourceFileRefs",
      "environmentBehaviour",
      "breakingChangePolicy",
      "proof",
    ])
      if (!present(event[field]))
        out.push(finding("R26-event-semantics", subject, `event missing "${field}"`));
    if (!hasRealSourceReference(event.sourceFileRefs))
      out.push(finding("R26-event-semantics", subject, "event lacks real source file refs"));
    if (present(event.proof) && !proofExists(ctx, event.proof))
      out.push(finding("R26-event-semantics", subject, "event proof does not exist"));
    if (!testOnly && !/arbitrary payload is not allowed/i.test(event.payloadContract || ""))
      out.push(
        finding("R26-event-semantics", subject, "canonical event lacks a bounded payload contract")
      );
  }
  return out;
}
