import {
  TextField,
  Input as AriaInput,
  type TextFieldProps,
  type InputProps as AriaInputProps,
} from "react-aria-components";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const inputVariants = cva(
  "flex h-10 w-full rounded-md border bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-gray-400 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0",
        error:
          "border-red-500 focus:border-red-500 focus:ring-2 focus:ring-red-500 focus:ring-offset-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface InputProps
  extends Omit<TextFieldProps, "children">, VariantProps<typeof inputVariants> {
  inputProps?: AriaInputProps;
  className?: string;
  placeholder?: string;
}

export function Input({ className, variant, inputProps, placeholder, ...props }: InputProps) {
  return (
    <TextField {...props}>
      <AriaInput
        placeholder={placeholder}
        className={cn(inputVariants({ variant }), className)}
        {...inputProps}
      />
    </TextField>
  );
}
