import type { ReactNode } from "react";
import {
  TooltipTrigger,
  Tooltip as AriaTooltip,
  type TooltipProps as AriaTooltipProps,
} from "react-aria-components";
import { cn } from "../lib/utils";

export interface TooltipProps extends AriaTooltipProps {
  trigger: ReactNode;
  delay?: number;
  className?: string;
  children: ReactNode;
}

export function Tooltip({ trigger, delay = 700, className, children, ...props }: TooltipProps) {
  return (
    <TooltipTrigger delay={delay}>
      {trigger}
      <AriaTooltip
        className={cn(
          "z-50 rounded-md bg-gray-900 px-2 py-1 text-xs text-white shadow-md outline-none",
          className
        )}
        {...props}
      >
        {children}
      </AriaTooltip>
    </TooltipTrigger>
  );
}
