// Generic full-replace "config collection" editor (e.g. IdP claim mappings): a single GET loads a
// config object, rows are added/edited/removed CLIENT-side, and one Save command full-replaces the
// whole config via PATCH. Entirely capability-agnostic — driven by the harness `collection`
// metadata. Used when a capability declares mode: "collection-config".
import { useState } from "react";
import { Button, LiveRegion, Alert } from "@platform/ui-design-system";
import { FormRenderer, type FieldDef } from "./form-renderer";

interface CollectionMeta {
  collectionKey: string;
  idField: string;
  alias?: string;
  fields: FieldDef[];
  conflictMessage?: string;
}
type Row = Record<string, string>;

function substitute(endpoint: string, alias: string): string {
  return endpoint.replace(/[:{][^/}]+}?/g, encodeURIComponent(alias));
}

export function ConfigCollectionView({
  capabilityKey,
  collection,
  initialRows,
  otherConfig,
  canEdit,
  saveCommand,
  notice,
}: {
  capabilityKey: string;
  collection: CollectionMeta;
  initialRows: Row[];
  otherConfig: Record<string, unknown>;
  canEdit: boolean;
  saveCommand: { endpoint: string; method: string; successMessage?: string } | null;
  notice?: string;
}) {
  const [rows, setRows] = useState<Row[]>(() => initialRows.map((r) => ({ ...r })));
  const [mode, setMode] = useState<
    { kind: "list" } | { kind: "add" } | { kind: "edit"; index: number }
  >({
    kind: "list",
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const id = collection.idField;

  function upsert(values: Row, setErrors: (e: Record<string, string>) => void, index?: number) {
    const dup = rows.some((r, i) => r[id] === values[id] && i !== index);
    if (dup) {
      setErrors({ [id]: collection.conflictMessage ?? `${id} is already mapped` });
      return;
    }
    setRows((prev) =>
      index == null ? [...prev, values] : prev.map((r, i) => (i === index ? values : r))
    );
    setMode({ kind: "list" });
  }

  async function save() {
    if (!saveCommand) return;
    setError("");
    const endpoint = substitute(saveCommand.endpoint, collection.alias ?? "default");
    const res = await fetch(endpoint, {
      method: saveCommand.method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...otherConfig, [collection.collectionKey]: rows }),
    });
    if (res.status === 422) {
      const data = (await res.json().catch(() => ({}))) as { fieldErrors?: Record<string, string> };
      setError(Object.values(data.fieldErrors ?? { _: "The server rejected the mapping" })[0]);
      return;
    }
    if (res.status >= 500) {
      setError("The server could not save the mapping. Please try again.");
      return;
    }
    setMessage(saveCommand.successMessage ?? "Saved");
  }

  return (
    <>
      {notice && (
        <Alert variant="warning" data-testid="external-idp-notice">
          {notice}
        </Alert>
      )}
      <LiveRegion tone="polite" data-testid="live-announcer">
        {message}
      </LiveRegion>
      {error && (
        <Alert variant="destructive" data-testid="save-error">
          {error}
        </Alert>
      )}

      {rows.length === 0 && mode.kind === "list" && (
        <p data-testid="empty-mappings">No mappings configured.</p>
      )}

      {mode.kind === "list" && (
        <table data-testid="capability-table">
          <thead>
            <tr>
              {collection.fields.map((f) => (
                <th key={f.name} scope="col">
                  {f.label}
                </th>
              ))}
              {canEdit && <th scope="col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row[id]} data-testid="capability-row" data-row-id={row[id]}>
                {collection.fields.map((f) => (
                  <td key={f.name}>{row[f.name]}</td>
                ))}
                {canEdit && (
                  <td>
                    <Button
                      variant="outline"
                      data-testid="row-edit-mapping"
                      aria-label={`Edit ${row[id]}`}
                      onPress={() => setMode({ kind: "edit", index })}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      data-testid="row-remove-mapping"
                      aria-label={`Remove ${row[id]}`}
                      onPress={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                    >
                      Remove
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {mode.kind === "list" && canEdit && (
        <>
          <Button data-testid="action-add" onPress={() => setMode({ kind: "add" })}>
            Add mapping
          </Button>
          <Button data-testid="action-save" variant="default" onPress={save}>
            Save mappings
          </Button>
        </>
      )}

      {mode.kind === "add" && (
        <section aria-label={`Add ${capabilityKey} mapping`} data-testid="add-form">
          <FormRenderer
            fields={collection.fields}
            submitLabel="Add mapping"
            onSubmit={(values, setErrors) => upsert(values as Row, setErrors)}
          />
          <Button
            variant="ghost"
            data-testid="form-cancel"
            onPress={() => setMode({ kind: "list" })}
          >
            Cancel
          </Button>
        </section>
      )}

      {mode.kind === "edit" && (
        <section aria-label={`Edit ${capabilityKey} mapping`} data-testid="edit-form">
          <FormRenderer
            fields={collection.fields}
            initial={rows[mode.index]}
            submitLabel="Save mapping"
            onSubmit={(values, setErrors) => upsert(values as Row, setErrors, mode.index)}
          />
          <Button
            variant="ghost"
            data-testid="form-cancel"
            onPress={() => setMode({ kind: "list" })}
          >
            Cancel
          </Button>
        </section>
      )}
    </>
  );
}
