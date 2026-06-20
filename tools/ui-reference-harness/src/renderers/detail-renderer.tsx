// Generic detail renderer — renders a single record's declared fields as a definition list.
// Used for read-only inspection of a selected row; no capability-specific layout.
export function DetailRenderer({
  columns,
  row,
}: {
  columns: Array<{ field: string; label: string }>;
  row: Record<string, unknown>;
}) {
  return (
    <dl data-testid="capability-detail">
      {columns.map((c) => (
        <div key={c.field}>
          <dt>{c.label}</dt>
          <dd data-field={c.field}>{String(row[c.field] ?? "")}</dd>
        </div>
      ))}
    </dl>
  );
}
