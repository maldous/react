import type { ReactNode } from "react";
import {
  Checkbox as AriaCheckbox,
  type CheckboxProps as AriaCheckboxProps,
  type CheckboxRenderProps,
} from "react-aria-components";
import { cn } from "../lib/utils";

export interface CheckboxProps extends AriaCheckboxProps {
  className?: string;
  children?: ReactNode;
}

export function Checkbox({ className, children, ...props }: Readonly<CheckboxProps>) {
  return (
    <AriaCheckbox
      className={cn(
        "group flex items-center gap-2 text-sm font-medium",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      {({ isSelected, isIndeterminate }: CheckboxRenderProps) => (
        <>
          <div
            className={cn(
              "flex h-4 w-4 items-center justify-center rounded border transition-colors",
              isSelected || isIndeterminate
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-300 bg-white"
            )}
          >
            {isIndeterminate ? (
              <span className="h-0.5 w-2 bg-current" />
            ) : isSelected ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3 w-3"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : null}
          </div>
          {children}
        </>
      )}
    </AriaCheckbox>
  );
}
