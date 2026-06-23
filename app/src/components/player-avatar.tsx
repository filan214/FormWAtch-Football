import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Understat carries no player photos (players.photo_url is always null),
 * so the kit identity is a numbered-shirt style initials block.
 */
export function PlayerAvatar({
  name,
  color = "#c6f33f",
  className,
}: {
  name: string;
  /** Hex color — gets an alpha suffix appended for the border. */
  color?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-12 shrink-0 items-center justify-center rounded-sm border bg-card font-display text-lg font-bold",
        className,
      )}
      style={{ borderColor: `${color}59`, color }}
    >
      {initials(name)}
    </span>
  );
}
