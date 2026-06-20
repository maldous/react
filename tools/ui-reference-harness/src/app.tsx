// Semantic Reference Harness — generic application shell.
//
// This is the ONLY React entry that renders capabilities, and it is entirely capability-agnostic:
// it drives every harness-enabled capability from its declarative record (table/fields/commands/
// fixtures). There are deliberately no per-capability page components — adding a capability means
// adding a record + fixtures + a journey, never React code.
import { useCallback, useState } from "react";
import { Button, LiveRegion, Alert } from "@platform/ui-design-system";
import { resolveView } from "./capability-controller.mjs";
import { StateView } from "./renderers/state-view";
import { TableRenderer } from "./renderers/table-renderer";
import { FormRenderer } from "./renderers/form-renderer";

interface Selection {
  capability: string | null;
  persona: string | null;
  state: string;
}

type Mode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; row: Row }
  | { kind: "confirm-delete"; row: Row };
type Row = Record<string, unknown>;

function substitute(endpoint: string, id: string): string {
  return endpoint.replace(/[:{][^/}]+}?/g, encodeURIComponent(id));
}

export function App({ capability, selection }: { capability: unknown; selection: Selection }) {
  const view = resolveView({
    capability,
    persona: selection.persona,
    state: selection.state,
  }) as ReturnType<typeof resolveView> & {
    harness?: Record<string, unknown>;
    listFixture?: { body?: Record<string, unknown> };
    table?: {
      collectionKey: string;
      idField: string;
      columns: Array<{ field: string; label: string }>;
    };
    commands?: Array<Record<string, unknown>>;
    fields?: Array<Record<string, unknown>>;
  };

  if (view.kind === "not-harness-enabled") {
    return (
      <main>
        <h1>Semantic Reference Harness</h1>
        <p data-testid="not-harness-enabled">
          {selection.capability
            ? `Capability "${selection.capability}" is not harness-enabled.`
            : "Select a capability via ?capability=…&persona=…&state=…"}
        </p>
      </main>
    );
  }

  const harness = view.harness as Record<string, unknown>;
  const capabilityKey = String(harness["capabilityKey"]);

  if (view.kind === "forbidden") {
    return (
      <main>
        <h1>{capabilityKey}</h1>
        <StateView state="forbidden" capabilityKey={capabilityKey} />
      </main>
    );
  }

  return (
    <main>
      <h1>{capabilityKey}</h1>
      <CapabilityView view={view as never} capabilityKey={capabilityKey} />
    </main>
  );
}

function CapabilityView({
  view,
  capabilityKey,
}: {
  view: {
    dataState: string;
    listFixture?: { body?: Record<string, unknown> };
    table?: {
      collectionKey: string;
      idField: string;
      columns: Array<{ field: string; label: string }>;
    };
    commands?: Array<Record<string, unknown>>;
    fields?: Array<Record<string, unknown>>;
  };
  capabilityKey: string;
}) {
  const table = view.table;
  const initialRows = (): Row[] => {
    const body = view.listFixture?.body || {};
    const arr = table ? (body[table.collectionKey] as Row[]) : [];
    return Array.isArray(arr) ? [...arr] : [];
  };
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [message, setMessage] = useState("");
  const [serverError, setServerError] = useState(false);

  const commands = view.commands || [];
  const createCmd = commands.find((c) => String(c["commandId"]).includes("create"));
  const editCmd = commands.find(
    (c) => String(c["commandId"]).includes("edit") || String(c["commandId"]).includes("update")
  );
  const deleteCmd = commands.find((c) => String(c["commandId"]).includes("delete"));
  const idField = table?.idField ?? "id";

  const runMutation = useCallback(
    async (
      cmd: Record<string, unknown>,
      body: Record<string, string> | null,
      id: string | null,
      onFieldErrors?: (e: Record<string, string>) => void
    ): Promise<boolean> => {
      setServerError(false);
      const endpoint = id ? substitute(String(cmd["endpoint"]), id) : String(cmd["endpoint"]);
      const res = await fetch(endpoint, {
        method: String(cmd["method"]),
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 422) {
        const data = (await res.json().catch(() => ({}))) as {
          fieldErrors?: Record<string, string>;
        };
        onFieldErrors?.(data.fieldErrors || {});
        return false;
      }
      if (res.status >= 500) {
        setServerError(true);
        return false;
      }
      setMessage(String(cmd["successMessage"] ?? `${cmd["commandId"]} succeeded`));
      return true;
    },
    []
  );

  const fields = (view.fields || []) as Array<{
    name: string;
    label: string;
    validation?: string[];
    testId?: string;
  }>;

  return (
    <>
      <LiveRegion tone="polite" data-testid="live-announcer">
        {message}
      </LiveRegion>
      {serverError && (
        <Alert variant="destructive" data-testid="mutation-error">
          The server returned an error. Please try again.
        </Alert>
      )}

      {["loading", "empty", "serverError"].includes(view.dataState) && mode.kind === "list" && (
        <StateView state={view.dataState} capabilityKey={capabilityKey} />
      )}
      {view.dataState === "degraded" && (
        <StateView state="degraded" capabilityKey={capabilityKey} />
      )}

      {mode.kind === "list" && createCmd && (
        <Button data-testid="action-create" onPress={() => setMode({ kind: "create" })}>
          Create {capabilityKey}
        </Button>
      )}

      {mode.kind === "list" &&
        table &&
        view.dataState !== "loading" &&
        view.dataState !== "serverError" && (
          <TableRenderer
            table={table}
            rows={rows}
            rowCommands={[
              ...(editCmd ? [{ commandId: String(editCmd["commandId"]), label: "Edit" }] : []),
              ...(deleteCmd
                ? [{ commandId: String(deleteCmd["commandId"]), label: "Delete" }]
                : []),
            ]}
            onRowCommand={(commandId, row) => {
              if (deleteCmd && commandId === deleteCmd["commandId"])
                setMode({ kind: "confirm-delete", row });
              else setMode({ kind: "edit", row });
            }}
          />
        )}

      {mode.kind === "create" && createCmd && (
        <section aria-label={`Create ${capabilityKey}`} data-testid="create-form">
          <FormRenderer
            fields={fields}
            submitLabel={`Create ${capabilityKey}`}
            onSubmit={async (values, setErrors) => {
              const ok = await runMutation(createCmd, values, null, (fe) =>
                setErrors(Object.keys(fe).length ? fe : { [fields[0].name]: "Rejected by server" })
              );
              if (ok) {
                setRows((r) => [...r, { [idField]: `new-${r.length + 1}`, ...values }]);
                setMode({ kind: "list" });
              }
            }}
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

      {mode.kind === "edit" && editCmd && (
        <section aria-label={`Edit ${capabilityKey}`} data-testid="edit-form">
          <FormRenderer
            fields={fields}
            initial={Object.fromEntries(
              fields.map((f) => [f.name, String((mode.row as Row)[f.name] ?? "")])
            )}
            submitLabel={`Save ${capabilityKey}`}
            onSubmit={async (values, setErrors) => {
              const id = String((mode.row as Row)[idField]);
              const ok = await runMutation(editCmd, values, id, (fe) =>
                setErrors(Object.keys(fe).length ? fe : { [fields[0].name]: "Rejected by server" })
              );
              if (ok) {
                setRows((r) => r.map((x) => (String(x[idField]) === id ? { ...x, ...values } : x)));
                setMode({ kind: "list" });
              }
            }}
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

      {mode.kind === "confirm-delete" && deleteCmd && (
        <ConfirmDelete
          capabilityKey={capabilityKey}
          onCancel={() => setMode({ kind: "list" })}
          onConfirm={async () => {
            const id = String((mode.row as Row)[idField]);
            const ok = await runMutation(deleteCmd, null, id);
            if (ok) {
              setRows((r) => r.filter((x) => String(x[idField]) !== id));
              setMode({ kind: "list" });
            }
          }}
        />
      )}
    </>
  );
}

function ConfirmDelete({
  capabilityKey,
  onConfirm,
  onCancel,
}: {
  capabilityKey: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="alertdialog" aria-label={`Delete ${capabilityKey}`} data-testid="confirm-delete">
      <p>Are you sure you want to delete this {capabilityKey}?</p>
      <Button autoFocus variant="destructive" data-testid="confirm-delete-yes" onPress={onConfirm}>
        Confirm delete
      </Button>
      <Button variant="ghost" data-testid="confirm-delete-no" onPress={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
