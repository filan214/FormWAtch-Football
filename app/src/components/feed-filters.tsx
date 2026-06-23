"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { TYPE_META } from "@/lib/anomaly";
import { ANOMALY_TYPES } from "@/types/insight";
import { cn } from "@/lib/utils";

const SEVERITY_OPTIONS = [
  { value: "60", label: "Severity ≥ 60" },
  { value: "40", label: "Severity ≥ 40" },
  { value: "all", label: "All severities" },
] as const;

function FilterSelect({
  value,
  onChange,
  children,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="microlabel">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 cursor-pointer rounded-sm border border-input bg-card px-2 font-mono text-xs uppercase tracking-wider text-foreground outline-none transition-colors hover:border-ring focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </select>
    </label>
  );
}

export function FeedFilters({
  teams,
  count,
}: {
  teams: string[];
  count: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function setParam(key: string, value: string, defaultValue: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === defaultValue) params.delete(key);
    else params.set(key, value);
    startTransition(() => {
      router.replace(
        params.size ? `${pathname}?${params.toString()}` : pathname,
        { scroll: false },
      );
    });
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-3 transition-opacity",
        isPending && "opacity-60",
      )}
    >
      <FilterSelect
        label="Type"
        value={searchParams.get("type") ?? "all"}
        onChange={(v) => setParam("type", v, "all")}
      >
        <option value="all">All types</option>
        {ANOMALY_TYPES.map((t) => (
          <option key={t} value={t}>
            {TYPE_META[t].label}
          </option>
        ))}
      </FilterSelect>

      <FilterSelect
        label="Team"
        value={searchParams.get("team") ?? "all"}
        onChange={(v) => setParam("team", v, "all")}
      >
        <option value="all">All teams</option>
        {teams.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </FilterSelect>

      <FilterSelect
        label="Floor"
        value={searchParams.get("sev") ?? "60"}
        onChange={(v) => setParam("sev", v, "60")}
      >
        {SEVERITY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </FilterSelect>

      <span className="microlabel ml-auto">
        {count} {count === 1 ? "anomaly" : "anomalies"}
      </span>
    </div>
  );
}
