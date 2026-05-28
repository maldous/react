import {
  TextField,
  TextArea as AriaTextArea,
  type TextFieldProps,
  type TextAreaProps as AriaTextAreaProps,
} from "react-aria-components";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const textareaVariants = cva(
  "flex min-h-[80px] w-full rounded-md border bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-gray-400 disabled:cursor-not-allowed disabled:opacity-50",
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
}: TextareaProps) {
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
