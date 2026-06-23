import { TYPE_META } from "@/lib/anomaly";
import type { AnomalyType } from "@/types/insight";
import { cn } from "@/lib/utils";

export function TypeBadge({
  type,
  size = "md",
}: {
  type: AnomalyType;
  size?: "sm" | "md";
}) {
  const meta = TYPE_META[type];
  return (
    <span
      className={cn(
        "microlabel inline-flex w-fit items-center gap-1.5 rounded-sm border px-2",
        size === "sm" ? "py-0.5 text-[0.625rem]" : "py-1",
      )}
      style={{
        color: meta.color,
        borderColor: `${meta.color}59`,
        backgroundColor: `${meta.color}14`,
      }}
    >
      <span
        className="inline-block size-1.5 -skew-x-12"
        style={{ backgroundColor: meta.color }}
      />
      {meta.label}
    </span>
  );
}
