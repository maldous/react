import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export interface SectionHeaderProps {
  heading: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function SectionHeader({ heading, description, action, className }: SectionHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div>
        <h2 className="text-xl font-semibold text-gray-900">{heading}</h2>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
