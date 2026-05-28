import {
  TextField,
  Label,
  Input,
  FieldError,
  Text,
  type TextFieldProps,
} from "react-aria-components";
import { cn } from "../lib/utils";

export interface FormFieldProps extends Omit<TextFieldProps, "children"> {
  label?: string;
  description?: string;
  errorMessage?: string;
  placeholder?: string;
  className?: string;
}

export function FormField({
  label,
  description,
  errorMessage,
  placeholder,
  className,
  isInvalid,
  ...props
}: FormFieldProps) {
  return (
    <TextField
      className={cn("flex flex-col gap-1.5", className)}
      isInvalid={isInvalid || !!errorMessage}
      {...props}
    >
      {label && <Label className="text-sm font-medium text-gray-900">{label}</Label>}
      <Input
        placeholder={placeholder}
        className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 invalid:border-red-500"
      />
      {description && (
        <Text slot="description" className="text-xs text-gray-500">
          {description}
        </Text>
      )}
      <FieldError className="text-xs text-red-600">{errorMessage}</FieldError>
    </TextField>
  );
}
