import type { ReactNode } from "react";
import {
  SwitchButton as AriaSwitchButton,
  SwitchField as AriaSwitchField,
  type SwitchButtonRenderProps,
  type SwitchFieldProps as AriaSwitchFieldProps,
} from "react-aria-components";
import { cn } from "../lib/utils";

export interface SwitchProps extends AriaSwitchFieldProps {
  className?: string;
  children?: ReactNode;
  "data-testid"?: string;
  "aria-label"?: string;
}

export function Switch({
  className,
  children,
  "data-testid": testId,
  "aria-label": ariaLabel,
  ...fieldProps
}: Readonly<SwitchProps>) {
  return (
    <AriaSwitchField {...fieldProps}>
      <AriaSwitchButton
        className={cn(
          "group flex cursor-pointer items-center gap-2 text-sm font-medium",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        data-testid={testId}
        aria-label={ariaLabel}
      >
        {({ isSelected }: SwitchButtonRenderProps) => (
          <>
            <div
              className={cn(
                "relative flex h-6 w-11 items-center rounded-full border-2 border-transparent transition-colors",
                isSelected ? "bg-blue-600" : "bg-gray-200"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform",
                  isSelected ? "translate-x-5" : "translate-x-0"
                )}
              />
            </div>
            {children}
          </>
        )}
      </AriaSwitchButton>
    </AriaSwitchField>
  );
}
