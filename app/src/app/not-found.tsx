import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col items-start px-4 py-24 sm:px-6">
      <p className="microlabel">404</p>
      <h1 className="mt-2 font-display text-5xl font-bold uppercase tracking-tight sm:text-7xl">
        Off the <span className="text-primary">pitch</span>
      </h1>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
        Nothing at this address — the anomaly may have been resolved and
        rotated off the board.
      </p>
      <Link
        href="/"
        className="microlabel mt-8 rounded-sm border border-border bg-card px-4 py-2 transition-colors hover:bg-accent hover:text-primary"
      >
        ← back to the anomaly board
      </Link>
    </div>
  );
}
