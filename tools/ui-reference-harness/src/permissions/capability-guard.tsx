// Generic permission guard — a persona without the capability's read permission gets the shared
// ForbiddenState, never the data. Mirrors the product's RequirePermission boundary semantically.
import type { ReactNode } from "react";
import { canRead } from "../capability-controller.mjs";
import { StateView } from "../renderers/state-view";

export function CapabilityGuard({
  harness,
  persona,
  children,
}: {
  harness: { capabilityKey: string };
  persona: string;
  children: ReactNode;
}) {
  // eslint-disable-next-line
  if (!canRead(harness as never, persona)) {
    return <StateView state="forbidden" capabilityKey={harness.capabilityKey} />;
  }
  return <>{children}</>;
}
