import { cn } from "../lib/utils";

export interface LoadingStateProps {
  message?: string;
  ariaLabel?: string;
  className?: string;
}

export function LoadingState({ message, ariaLabel, className }: Readonly<LoadingStateProps>) {
  return (
    <output
      aria-label={ariaLabel ?? message}
      className={cn("flex flex-col items-center justify-center gap-3 py-12", className)}
    >
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
      {message && <p className="text-sm text-gray-500">{message}</p>}
    </output>
  );
}
