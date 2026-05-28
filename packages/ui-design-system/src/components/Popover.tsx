import type { ReactNode } from "react";
import {
  Popover as AriaPopover,
  DialogTrigger,
  type PopoverProps as AriaPopoverProps,
} from "react-aria-components";
import { cn } from "../lib/utils";

export interface PopoverProps extends Omit<AriaPopoverProps, "trigger"> {
  triggerElement: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Popover({ triggerElement, className, children, ...props }: PopoverProps) {
  return (
    <DialogTrigger>
      {triggerElement}
      <AriaPopover
        className={cn(
          "z-50 min-w-[8rem] overflow-auto rounded-md border border-gray-200 bg-white p-1 shadow-md outline-none",
          className
        )}
        {...props}
      >
        {children}
      </AriaPopover>
    </DialogTrigger>
  );
}
