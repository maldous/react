// Generic table renderer — renders a capability's collection from its fixture body using the
// declared table contract (collectionKey + columns). Per-row actions are wired to the commands the
// active persona is allowed to run. No capability-specific columns are hard-coded.
import { Button } from "@platform/ui-design-system";

export interface TableContract {
  collectionKey: string;
  idField: string;
  columns: Array<{ field: string; label: string }>;
}

export interface RowCommand {
  commandId: string;
  label: string;
}

export function TableRenderer({
  table,
  rows,
  rowCommands,
  onRowCommand,
}: {
  table: TableContract;
  rows: Array<Record<string, unknown>>;
  rowCommands: RowCommand[];
  onRowCommand: (commandId: string, row: Record<string, unknown>) => void;
}) {
  return (
    <table data-testid="capability-table">
      <thead>
        <tr>
          {table.columns.map((c) => (
            <th key={c.field} scope="col">
              {c.label}
            </th>
          ))}
          {rowCommands.length > 0 && <th scope="col">Actions</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const id = String(row[table.idField]);
          return (
            <tr key={id} data-testid="capability-row" data-row-id={id}>
              {table.columns.map((c) => (
                <td key={c.field}>{String(row[c.field] ?? "")}</td>
              ))}
              {rowCommands.length > 0 && (
                <td>
                  {rowCommands.map((rc) => (
                    <Button
                      key={rc.commandId}
                      variant={rc.commandId.includes("delete") ? "destructive" : "outline"}
                      onPress={() => onRowCommand(rc.commandId, row)}
                      data-testid={`row-${rc.commandId}`}
                      aria-label={`${rc.label} ${id}`}
                    >
                      {rc.label}
                    </Button>
                  ))}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
