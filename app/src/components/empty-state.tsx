export function EmptyState({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
      <p className="font-display text-2xl font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        {detail}
      </p>
    </div>
  );
}

export function OfflineState() {
  return (
    <EmptyState
      title="Data offline"
      detail="The database is unreachable right now. The board repopulates automatically once the connection returns."
    />
  );
}
