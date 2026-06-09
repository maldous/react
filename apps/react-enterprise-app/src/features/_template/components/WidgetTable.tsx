import { DataTable } from "@platform/ui-design-system";

// Presentational subcomponent: receives data via props, renders it, raises events
// upward. No hooks that fetch, no GraphQL, no client knowledge — pure and trivially
// testable. List/table features use the design-system DataTable (sortable,
// virtualised, expandable) rather than hand-rolling a <table>.

export interface Widget {
  id: string;
  name: string;
}

export function WidgetTable({ widgets }: { widgets: Widget[] }) {
  return (
    <DataTable
      data={widgets}
      columns={[
        { accessorKey: "name", header: "Name" },
        { accessorKey: "id", header: "ID" },
      ]}
    />
  );
}
