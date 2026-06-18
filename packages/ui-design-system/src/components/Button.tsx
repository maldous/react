import { Button as AriaButton, type ButtonProps as AriaButtonProps } from "react-aria-components";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-primary",
        destructive:
          "bg-danger text-primary-foreground hover:bg-danger/90 focus-visible:ring-danger",
        outline:
          "border border-border bg-surface text-fg hover:bg-surface-muted focus-visible:ring-primary",
        ghost: "text-fg hover:bg-surface-muted focus-visible:ring-primary",
        link: "text-primary underline-offset-4 hover:underline focus-visible:ring-primary",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
);

export interface ButtonProps extends AriaButtonProps, VariantProps<typeof buttonVariants> {
  className?: string;
}

export function Button({ className, variant, size, ...props }: Readonly<ButtonProps>) {
  return <AriaButton className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
