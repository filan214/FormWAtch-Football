"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MatchLine } from "@/db/queries";
import { fmt, fmtDate } from "@/lib/format";

const col = createColumnHelper<MatchLine>();

const columns = [
  col.accessor("date", {
    header: "Date",
    cell: (c) => fmtDate(c.getValue()),
  }),
  col.accessor("opponent", {
    header: "Opponent",
    cell: (c) => (
      <span className="text-foreground">
        {c.row.original.home ? "vs" : "at"} {c.getValue()}
      </span>
    ),
  }),
  col.accessor("minutes", { header: "Min" }),
  col.accessor("goals", {
    header: "G",
    cell: (c) =>
      c.getValue() > 0 ? (
        <span className="font-semibold text-primary">{c.getValue()}</span>
      ) : (
        c.getValue()
      ),
  }),
  col.accessor("shots", { header: "Sh" }),
  col.accessor("xg", { header: "xG", cell: (c) => fmt(c.getValue()) }),
  col.accessor("xa", { header: "xA", cell: (c) => fmt(c.getValue()) }),
  col.accessor("keyPasses", { header: "KP" }),
];

/** The recent-window match lines that triggered the detection. */
export function MatchesTable({ data }: { data: MatchLine[] }) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <Table className="tnum">
      <TableHeader>
        {table.getHeaderGroups().map((hg) => (
          <TableRow key={hg.id} className="hover:bg-transparent">
            {hg.headers.map((h) => (
              <TableHead key={h.id} className="microlabel h-9">
                {flexRender(h.column.columnDef.header, h.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id} className="font-mono text-xs">
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id} className="py-2.5 text-muted-foreground">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
