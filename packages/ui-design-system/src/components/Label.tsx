import { Label as AriaLabel, type LabelProps as AriaLabelProps } from "react-aria-components";
import { cn } from "../lib/utils";

export interface LabelProps extends AriaLabelProps {
  className?: string;
}

export function Label({ className, ...props }: LabelProps) {
  return (
    <AriaLabel
      className={cn(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className
      )}
      {...props}
    />
  );
}
