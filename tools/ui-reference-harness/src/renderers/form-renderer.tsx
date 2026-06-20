// Generic form renderer — builds an accessible form from the capability's declared fields and
// validation rules. Uses the shared FormField (react-aria TextField) so each field gets an
// associated <FieldError> (aria-describedby) and aria-invalid for free. Client validation runs
// before submit; server-side field errors are surfaced into the same accessible slots.
import { useState, type FormEvent } from "react";
import { Button, FormField } from "@platform/ui-design-system";

export interface FieldDef {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  validation?: string[];
  errorId?: string;
  testId?: string;
}

function ruleMessage(rule: string, label: string): string {
  if (rule === "required") return `${label} is required`;
  if (rule.startsWith("maxLength:")) return `${label} is too long (max ${rule.split(":")[1]})`;
  if (rule === "noSlash") return `${label} must not contain "/"`;
  if (rule.startsWith("pattern:")) return `${label} has an invalid format`;
  return `${label} is invalid`;
}

function validateField(def: FieldDef, value: string): string | null {
  for (const rule of def.validation || []) {
    if (rule === "required" && value.trim() === "") return ruleMessage(rule, def.label);
    if (rule.startsWith("maxLength:") && value.length > Number(rule.split(":")[1]))
      return ruleMessage(rule, def.label);
    if (rule === "noSlash" && value.includes("/")) return ruleMessage(rule, def.label);
    if (rule.startsWith("pattern:") && !new RegExp(rule.slice("pattern:".length)).test(value))
      return ruleMessage(rule, def.label);
  }
  return null;
}

export function FormRenderer({
  fields,
  initial,
  submitLabel,
  onSubmit,
}: {
  fields: FieldDef[];
  initial?: Record<string, string>;
  submitLabel: string;
  onSubmit: (
    values: Record<string, string>,
    setServerErrors: (errs: Record<string, string>) => void
  ) => void | Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of fields) v[f.name] = initial?.[f.name] ?? "";
    return v;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    for (const f of fields) {
      const msg = validateField(f, values[f.name] ?? "");
      if (msg) next[f.name] = msg;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    void onSubmit(values, setErrors);
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label={submitLabel}>
      {fields.map((f) => (
        <FormField
          key={f.name}
          label={f.label}
          value={values[f.name] ?? ""}
          onChange={(v: string) => setValues((prev) => ({ ...prev, [f.name]: v }))}
          isInvalid={!!errors[f.name]}
          errorMessage={errors[f.name]}
          inputProps={{ "data-testid": f.testId ?? `field-${f.name}` }}
        />
      ))}
      <Button type="submit" data-testid="form-submit">
        {submitLabel}
      </Button>
    </form>
  );
}
