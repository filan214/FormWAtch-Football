import { Skeleton } from "@/components/ui/skeleton";

export default function AnomalyLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Skeleton className="h-3 w-32" />
      <div className="mt-6 flex items-end justify-between border-b border-border pb-8">
        <div className="flex items-center gap-5">
          <Skeleton className="size-20" />
          <div>
            <Skeleton className="h-4 w-64" />
            <Skeleton className="mt-3 h-12 w-80" />
          </div>
        </div>
        <Skeleton className="h-20 w-28" />
      </div>
      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
        <div className="space-y-8">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    </div>
  );
}
