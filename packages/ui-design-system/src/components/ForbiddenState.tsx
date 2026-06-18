import { ShieldOff } from "lucide-react";
import { cn } from "../lib/utils";

export interface ForbiddenStateProps {
  title: string;
  description?: string;
  className?: string;
}

export function ForbiddenState({ title, description, className }: Readonly<ForbiddenStateProps>) {
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center justify-center gap-4 py-12 text-center", className)}
    >
      <ShieldOff className="h-12 w-12 text-yellow-400" aria-hidden="true" />
      <div>
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>
    </div>
  );
}
