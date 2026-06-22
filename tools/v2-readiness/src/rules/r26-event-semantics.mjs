import { finding } from "../vocab.mjs";

const present = (v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0);

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
    if (!present(event.owner))
      out.push(finding("R26-event-semantics", subject, "event has no owner"));
    if (!present(event.schema) || !present(event.version) || !present(event.schema?.version))
      out.push(finding("R26-event-semantics", subject, "event schema is unversioned"));
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
      "orderingExpectation",
      "retention",
      "auditRelationship",
      "proof",
    ])
      if (!present(event[field]))
        out.push(finding("R26-event-semantics", subject, `event missing "${field}"`));
  }
  return out;
}
