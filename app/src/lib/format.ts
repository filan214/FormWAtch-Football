export function fmt(x: number | null | undefined, dp = 2): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toFixed(dp);
}

/** p-values in compact scientific form below 0.001 (mono-font friendly). */
export function fmtP(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return "—";
  if (p === 0) return "<1e-6";
  if (p < 0.001) return p.toExponential(1).replace("e-", "e-");
  return p.toFixed(3);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function fmtSigned(x: number | null | undefined, dp = 2): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return `${x >= 0 ? "+" : ""}${x.toFixed(dp)}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
