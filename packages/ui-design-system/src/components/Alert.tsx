import type { HTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const alertVariants = cva("relative flex w-full items-start gap-3 rounded-lg border p-4", {
  variants: {
    variant: {
      default: "border-border bg-surface text-fg",
      destructive: "border-danger/40 bg-danger-surface text-danger",
      warning: "border-warning/40 bg-warning-surface text-warning",
      success: "border-success/40 bg-success-surface text-success",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export interface AlertProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  icon?: ReactNode;
}

export function Alert({ className, variant, icon, children, ...props }: Readonly<AlertProps>) {
  return (
    <div role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function AlertTitle({ className, ...props }: Readonly<HTMLAttributes<HTMLHeadingElement>>) {
  return <h5 className={cn("mb-1 font-medium leading-none", className)} {...props} />;
}

export function AlertDescription({
  className,
  ...props
}: Readonly<HTMLAttributes<HTMLParagraphElement>>) {
  return <p className={cn("text-sm opacity-90", className)} {...props} />;
}
