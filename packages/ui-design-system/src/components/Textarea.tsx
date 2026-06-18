import {
  TextField,
  TextArea as AriaTextArea,
  type TextFieldProps,
  type TextAreaProps as AriaTextAreaProps,
} from "react-aria-components";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const textareaVariants = cva(
  "flex min-h-[80px] w-full rounded-md border bg-surface px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-fg-muted disabled:cursor-not-allowed disabled:opacity-50",
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

export interface TextareaProps
  extends Omit<TextFieldProps, "children">, VariantProps<typeof textareaVariants> {
  textAreaProps?: AriaTextAreaProps;
  className?: string;
  placeholder?: string;
}

export function Textarea({
  className,
  variant,
  textAreaProps,
  placeholder,
  ...props
}: Readonly<TextareaProps>) {
  return (
    <TextField {...props}>
      <AriaTextArea
        placeholder={placeholder}
        className={cn(textareaVariants({ variant }), className)}
        {...textAreaProps}
      />
    </TextField>
  );
}
