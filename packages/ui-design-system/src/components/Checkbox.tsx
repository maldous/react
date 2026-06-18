import type { ReactNode } from "react";
import {
  CheckboxButton as AriaCheckboxButton,
  CheckboxField as AriaCheckboxField,
  type CheckboxButtonRenderProps,
  type CheckboxFieldProps as AriaCheckboxFieldProps,
} from "react-aria-components";
import { cn } from "../lib/utils";

export interface CheckboxProps extends AriaCheckboxFieldProps {
  className?: string;
  children?: ReactNode;
  "data-testid"?: string;
  "aria-label"?: string;
}

function renderCheckboxMark(isSelected: boolean, isIndeterminate: boolean): ReactNode {
  if (isIndeterminate) {
    return <span className="h-0.5 w-2 bg-current" />;
  }
  if (isSelected) {
    return (
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
    );
  }
  return null;
}

export function Checkbox({
  className,
  children,
  "data-testid": testId,
  "aria-label": ariaLabel,
  ...fieldProps
}: Readonly<CheckboxProps>) {
  return (
    <AriaCheckboxField {...fieldProps}>
      <AriaCheckboxButton
        className={cn(
          "group flex items-center gap-2 text-sm font-medium",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        data-testid={testId}
        aria-label={ariaLabel}
      >
        {({ isSelected, isIndeterminate }: CheckboxButtonRenderProps) => (
          <>
            <div
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                isSelected || isIndeterminate
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-300 bg-white"
              )}
            >
              {renderCheckboxMark(isSelected, isIndeterminate)}
            </div>
            {children}
          </>
        )}
      </AriaCheckboxButton>
    </AriaCheckboxField>
  );
}
