import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export interface SectionHeaderProps {
  heading: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /** Heading level: 1 for a page title (one per page), 2 for a section (default). */
  level?: 1 | 2;
}

export function SectionHeader({
  heading,
  description,
  action,
  className,
  level = 2,
}: SectionHeaderProps) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div>
        <Heading className="text-xl font-semibold text-fg">{heading}</Heading>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
