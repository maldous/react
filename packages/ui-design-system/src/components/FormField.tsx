import {
  TextField,
  Label,
  Input,
  FieldError,
  Text,
  type TextFieldProps,
  type InputProps as AriaInputProps,
} from "react-aria-components";
import { cn } from "../lib/utils";

/** Allow data-* attributes (e.g. data-testid) on the forwarded input. */
type DataAttributes = { [key: `data-${string}`]: string | number | boolean | undefined };

export interface FormFieldProps extends Omit<TextFieldProps, "children"> {
  label?: string;
  description?: string;
  errorMessage?: string;
  placeholder?: string;
  className?: string;
  /**
   * Props forwarded to the underlying input (e.g. data-testid, autoComplete).
   * Lets the field carry attributes without re-implementing the control — pairs
   * with react-hook-form Controller (pass value/onChange/onBlur on the field).
   */
  inputProps?: AriaInputProps & DataAttributes;
}

export function FormField({
  label,
  description,
  errorMessage,
  placeholder,
  className,
  isInvalid,
  inputProps,
  ...props
}: Readonly<FormFieldProps>) {
  return (
    <TextField
      className={cn("flex flex-col gap-1.5", className)}
      isInvalid={isInvalid || !!errorMessage}
      {...props}
    >
      {label && <Label className="text-sm font-medium text-fg">{label}</Label>}
      <Input
        placeholder={placeholder}
        {...inputProps}
        className="flex h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-fg-muted focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 invalid:border-danger"
      />
      {description && (
        <Text slot="description" className="text-xs text-fg-muted">
          {description}
        </Text>
      )}
      <FieldError className="text-xs text-danger">{errorMessage}</FieldError>
    </TextField>
  );
}
