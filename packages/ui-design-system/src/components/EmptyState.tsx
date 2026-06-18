import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "../lib/utils";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className }: Readonly<EmptyStateProps>) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-4 py-12 text-center", className)}
    >
      <Inbox className="h-12 w-12 text-gray-300" aria-hidden="true" />
      <div>
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
