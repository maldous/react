import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils";

export interface LiveRegionProps extends HTMLAttributes<HTMLDivElement> {
  /** "polite" (status, default) or "assertive" (alert). */
  tone?: "polite" | "assertive";
}

/**
 * Always-mounted ARIA live region for async status/error feedback (WCAG 2.2 AA,
 * ADR-0019). Mount it once near the content it describes and update its children
 * — screen readers announce the change. Reserve vertical space with a min height
 * so the layout does not shift when a message appears.
 *
 * tone="polite"  → role="status",  aria-live="polite"   (success / progress)
 * tone="assertive" → role="alert", aria-live="assertive" (errors)
 */
export function LiveRegion({
  tone = "polite",
  className,
  children,
  ...props
}: Readonly<LiveRegionProps>) {
  return (
    <div
      role={tone === "assertive" ? "alert" : "status"}
      aria-live={tone}
      className={cn("min-h-[1.25rem] text-sm", className)}
      {...props}
    >
      {children}
    </div>
  );
}
