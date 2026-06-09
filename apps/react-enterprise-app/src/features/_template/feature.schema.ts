import { z } from "zod";

// Feature-local form/input schemas. Keep validation bounds in lock-step with the
// owning contract package (e.g. @platform/contracts-<domain>) and the server-side
// domain rules, so the form validates exactly what the API accepts.
//
// Prefer re-exporting the canonical request schema from the contract package when
// one exists (as the organisation feature does with
// UpdateOrganisationProfileRequestSchema) rather than redefining it here.

export const WidgetFormSchema = z.object({
  name: z.string().min(2, "feature.widget.form.name.tooShort").max(120),
});

export type WidgetFormValues = z.infer<typeof WidgetFormSchema>;
