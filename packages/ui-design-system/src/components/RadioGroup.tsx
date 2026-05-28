import {
  RadioGroup as AriaRadioGroup,
  Radio,
  type RadioGroupProps as AriaRadioGroupProps,
  type RadioRenderProps,
} from "react-aria-components";
import { cn } from "../lib/utils";

export interface RadioItem {
  value: string;
  label: string;
}

export interface RadioGroupProps extends AriaRadioGroupProps {
  items: RadioItem[];
  className?: string;
}

export function RadioGroup({ items, className, ...props }: RadioGroupProps) {
  return (
    <AriaRadioGroup className={cn("flex flex-col gap-2", className)} {...props}>
      {items.map((item) => (
        <Radio
          key={item.value}
          value={item.value}
          className="group flex cursor-pointer items-center gap-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {({ isSelected }: RadioRenderProps) => (
            <>
              <div
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full border transition-colors",
                  isSelected ? "border-blue-600 bg-blue-600" : "border-gray-300 bg-white"
                )}
              >
                {isSelected && <div className="h-2 w-2 rounded-full bg-white" />}
              </div>
              {item.label}
            </>
          )}
        </Radio>
      ))}
    </AriaRadioGroup>
  );
}
