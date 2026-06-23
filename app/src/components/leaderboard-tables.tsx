"use client";

import Link from "next/link";
import { useState } from "react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";

import { TypeBadge } from "@/components/type-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LeaderboardRow } from "@/db/queries";
import { fmt, fmtSigned } from "@/lib/format";

function playerCell(row: LeaderboardRow) {
  return (
    <Link
      href={`/player/${row.playerId}`}
      className="font-sans text-sm font-medium text-foreground transition-colors hover:text-primary"
    >
      {row.name}
      <span className="ml-2 font-mono text-[0.6875rem] text-muted-foreground">
        {row.team ?? ""}
      </span>
    </Link>
  );
}

function flagCell(row: LeaderboardRow) {
  if (!row.activeAnomaly) return null;
  return (
    <Link href={`/anomaly/${row.activeAnomaly.id}`}>
      <TypeBadge type={row.activeAnomaly.type} size="sm" />
    </Link>
  );
}

const num = (v: number | null, dp = 2) => (
  <span className="tnum">{fmt(v, dp)}</span>
);

const OVERPERFORMER_COLUMNS: ColumnDef<LeaderboardRow>[] = [
  { id: "player", header: "Player", cell: (c) => playerCell(c.row.original), enableSorting: false },
  { accessorKey: "minutes", header: "Min", cell: (c) => num(c.row.original.minutes, 0) },
  { accessorKey: "goals", header: "G", cell: (c) => num(c.row.original.goals, 0) },
  { accessorKey: "xg", header: "xG", cell: (c) => num(c.row.original.xg) },
  {
    accessorKey: "gMinusXg",
    header: "G−xG",
    cell: (c) => (
      <span className="tnum font-semibold text-primary">
        {fmtSigned(c.row.original.gMinusXg)}
      </span>
    ),
  },
  { accessorKey: "goalsP90", header: "G/90", cell: (c) => num(c.row.original.goalsP90) },
  { id: "flag", header: "Flag", cell: (c) => flagCell(c.row.original), enableSorting: false },
];

const BREAKOUT_COLUMNS: ColumnDef<LeaderboardRow>[] = [
  { id: "player", header: "Player", cell: (c) => playerCell(c.row.original), enableSorting: false },
  { accessorKey: "matches", header: "Apps", cell: (c) => num(c.row.original.matches, 0) },
  { accessorKey: "baselineXgP90", header: "xG/90 early", cell: (c) => num(c.row.original.baselineXgP90) },
  { accessorKey: "recentXgP90", header: "xG/90 last 6", cell: (c) => num(c.row.original.recentXgP90) },
  {
    accessorKey: "upliftXgP90",
    header: "Δ xG/90",
    cell: (c) => (
      <span className="tnum font-semibold text-primary">
        {fmtSigned(c.row.original.upliftXgP90)}
      </span>
    ),
  },
  { id: "flag", header: "Flag", cell: (c) => flagCell(c.row.original), enableSorting: false },
];

const REGRESSION_COLUMNS: ColumnDef<LeaderboardRow>[] = [
  { id: "player", header: "Player", cell: (c) => playerCell(c.row.original), enableSorting: false },
  { accessorKey: "goals", header: "G", cell: (c) => num(c.row.original.goals, 0) },
  { accessorKey: "xg", header: "xG", cell: (c) => num(c.row.original.xg) },
  {
    id: "ratio",
    accessorFn: (r) => (r.xg > 0 ? r.goals / r.xg : 0),
    header: "G/xG",
    cell: (c) => (
      <span className="tnum font-semibold" style={{ color: "#fb923c" }}>
        {fmt(c.getValue<number>())}
      </span>
    ),
  },
  { accessorKey: "gMinusXg", header: "G−xG", cell: (c) => num(c.row.original.gMinusXg) },
  { id: "flag", header: "Flag", cell: (c) => flagCell(c.row.original), enableSorting: false },
];

function SortableTable({
  data,
  columns,
  initialSort,
}: {
  data: LeaderboardRow[];
  columns: ColumnDef<LeaderboardRow>[];
  initialSort: SortingState;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <Table className="tnum">
      <TableHeader>
        {table.getHeaderGroups().map((hg) => (
          <TableRow key={hg.id} className="hover:bg-transparent">
            <TableHead className="microlabel h-9 w-8">#</TableHead>
            {hg.headers.map((h) => (
              <TableHead
                key={h.id}
                className="microlabel h-9 select-none"
                aria-sort={
                  h.column.getIsSorted() === "asc"
                    ? "ascending"
                    : h.column.getIsSorted() === "desc"
                      ? "descending"
                      : "none"
                }
              >
                {h.column.getCanSort() ? (
                  <button
                    type="button"
                    onClick={h.column.getToggleSortingHandler()}
                    className="microlabel inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-foreground"
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    <span className="text-[0.55rem]">
                      {h.column.getIsSorted() === "asc"
                        ? "▲"
                        : h.column.getIsSorted() === "desc"
                          ? "▼"
                          : "△"}
                    </span>
                  </button>
                ) : (
                  flexRender(h.column.columnDef.header, h.getContext())
                )}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row, i) => (
          <TableRow key={row.id} className="font-mono text-xs">
            <TableCell className="py-2.5 text-muted-foreground">
              {i + 1}
            </TableCell>
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

export function LeaderboardTabs({ rows }: { rows: LeaderboardRow[] }) {
  const overperformers = rows
    .filter((r) => r.minutes >= 900)
    .sort((a, b) => b.gMinusXg - a.gMinusXg)
    .slice(0, 20);
  const breakouts = rows
    .filter((r) => r.matches >= 10 && r.upliftXgP90 !== null)
    .sort((a, b) => (b.upliftXgP90 ?? 0) - (a.upliftXgP90 ?? 0))
    .slice(0, 20);
  const regression = rows
    .filter((r) => r.goals >= 5 && r.xg > 0)
    .sort((a, b) => b.goals / b.xg - a.goals / a.xg)
    .slice(0, 20);

  const tabClass =
    "microlabel cursor-pointer rounded-sm px-3 py-1.5 transition-colors data-selected:bg-accent data-selected:text-primary hover:text-foreground";

  return (
    <Tabs defaultValue="overperformers">
      <TabsList className="h-auto gap-1 rounded-sm border border-border bg-card p-1">
        <TabsTrigger value="overperformers" className={tabClass}>
          Overperformers
        </TabsTrigger>
        <TabsTrigger value="breakouts" className={tabClass}>
          Breakout watch
        </TabsTrigger>
        <TabsTrigger value="regression" className={tabClass}>
          Regression watch
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overperformers" className="mt-4">
        <p className="microlabel mb-3">
          season G−xG · min 900 minutes · chronic overperformance the weekly
          detector cannot see
        </p>
        <SortableTable
          data={overperformers}
          columns={OVERPERFORMER_COLUMNS}
          initialSort={[{ id: "gMinusXg", desc: true }]}
        />
      </TabsContent>

      <TabsContent value="breakouts" className="mt-4">
        <p className="microlabel mb-3">
          last-6 xG/90 vs earlier season · min 10 qualifying matches
        </p>
        <SortableTable
          data={breakouts}
          columns={BREAKOUT_COLUMNS}
          initialSort={[{ id: "upliftXgP90", desc: true }]}
        />
      </TabsContent>

      <TabsContent value="regression" className="mt-4">
        <p className="microlabel mb-3">
          goals per unit of xG · min 5 goals · the higher the ratio, the
          colder the regression bath
        </p>
        <SortableTable
          data={regression}
          columns={REGRESSION_COLUMNS}
          initialSort={[{ id: "ratio", desc: true }]}
        />
      </TabsContent>
    </Tabs>
  );
}
