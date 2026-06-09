import {
  TextField,
  Input as AriaInput,
  type TextFieldProps,
  type InputProps as AriaInputProps,
} from "react-aria-components";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const inputVariants = cva(
  "flex h-10 w-full rounded-md border bg-surface px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-fg-muted disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border-border focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-0",
        error:
          "border-danger focus-visible:border-danger focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-0",
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
