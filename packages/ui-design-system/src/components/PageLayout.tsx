import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export interface PageLayoutProps {
  className?: string;
  children?: ReactNode;
}

/**
 * Width-constraining page content container. Intentionally a <div>, NOT a
 * landmark: the authenticated AppShell owns the single <main id="main-content">,
 * so a page composed inside the shell must not introduce a second <main>
 * (ADR-ACT-0203). Use this to constrain content width within that main.
 */
export function PageLayout({ className, children }: PageLayoutProps) {
  return (
    <div className={cn("mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8", className)}>
      {children}
    </div>
  );
}
