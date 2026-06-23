import { Skeleton } from "@/components/ui/skeleton";

export default function PlayerLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Skeleton className="h-3 w-32" />
      <div className="mt-6 flex items-center gap-5 border-b border-border pb-8">
        <Skeleton className="size-20" />
        <div>
          <Skeleton className="h-3 w-56" />
          <Skeleton className="mt-3 h-12 w-72" />
        </div>
      </div>
      <Skeleton className="mt-8 h-96 w-full" />
      <Skeleton className="mt-10 h-8 w-56" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}
