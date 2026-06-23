import { Skeleton } from "@/components/ui/skeleton";

export default function FeedLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="border-b border-border pb-8">
        <Skeleton className="h-3 w-64" />
        <Skeleton className="mt-3 h-14 w-80" />
        <Skeleton className="mt-2 h-14 w-48" />
        <Skeleton className="mt-4 h-4 w-full max-w-xl" />
      </div>
      <div className="space-y-2 pt-16">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    </div>
  );
}
