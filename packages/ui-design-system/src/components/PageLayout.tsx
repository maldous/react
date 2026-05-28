import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export interface PageLayoutProps {
  className?: string;
  children?: ReactNode;
}

export function PageLayout({ className, children }: PageLayoutProps) {
  return (
    <main className={cn("mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8", className)}>
      {children}
    </main>
  );
}
