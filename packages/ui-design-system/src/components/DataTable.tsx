import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useState } from "react";
import { cn } from "../lib/utils";

export interface DataTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData>[];
  /** Height of the scrollable container in px (enables virtual scrolling). */
  height?: number;
  className?: string;
}

export function DataTable<TData>({ data, columns, height, className }: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    enabled: !!height,
  });

  const virtualRows = height ? virtualizer.getVirtualItems() : null;
  const totalSize = virtualizer.getTotalSize();

  return (
    <div className={cn("w-full overflow-auto rounded-md border", className)}>
      <div ref={parentRef} style={height ? { height, overflow: "auto" } : undefined}>
        <table className="w-full caption-bottom text-sm">
          <thead className="sticky top-0 z-10 bg-white border-b">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className="h-10 px-3 text-left align-middle font-medium text-gray-500 cursor-pointer select-none"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() === "asc"
                      ? " ?"
                      : header.column.getIsSorted() === "desc"
                        ? " ?"
                        : null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {virtualRows ? (
              <>
                <tr style={{ height: virtualRows[0]?.start ?? 0 }} />
                {virtualRows.map((vRow) => {
                  const row = rows[vRow.index];
                  if (!row) return null;
                  return (
                    <tr key={row.id} className="border-b transition-colors hover:bg-gray-50">
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-3 py-2 align-middle">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                <tr
                  style={{ height: totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0) }}
                />
              </>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b transition-colors hover:bg-gray-50">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
