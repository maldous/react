import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export interface CardProps {
  className?: string;
  children?: ReactNode;
}

export function Card({ className, children }: Readonly<CardProps>) {
  return (
    <div className={cn("rounded-lg border border-gray-200 bg-white shadow-sm", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: Readonly<CardProps>) {
  return <div className={cn("flex flex-col gap-1.5 p-6", className)}>{children}</div>;
}

export function CardBody({ className, children }: Readonly<CardProps>) {
  return <div className={cn("p-6 pt-0", className)}>{children}</div>;
}

export function CardFooter({ className, children }: Readonly<CardProps>) {
  return <div className={cn("flex items-center p-6 pt-0", className)}>{children}</div>;
}
