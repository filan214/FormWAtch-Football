import { Skeleton } from "@/components/ui/skeleton";

export default function LeaderboardsLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="border-b border-border pb-8">
        <Skeleton className="h-3 w-64" />
        <Skeleton className="mt-3 h-14 w-96" />
        <Skeleton className="mt-4 h-4 w-full max-w-xl" />
      </div>
      <Skeleton className="mt-8 h-10 w-96" />
      <div className="mt-4 space-y-1.5">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
