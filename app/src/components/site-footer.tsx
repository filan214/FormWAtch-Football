import { fetchPipelineStatus } from "@/db/queries";
import { fmtDate } from "@/lib/format";

/** Status footer reading `pipeline_runs` — proof the system is alive. */
export async function SiteFooter() {
  const run = await fetchPipelineStatus();

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-5 sm:px-6">
        <p className="microlabel">
          FormWatch · EPL · Understat data · weekly pipeline
        </p>
        <p className="microlabel flex items-center gap-2">
          {run ? (
            <>
              <span
                className={
                  run.status === "success"
                    ? "inline-block size-1.5 rounded-full bg-primary"
                    : "inline-block size-1.5 rounded-full bg-destructive"
                }
              />
              last run {run.status ?? "unknown"} ·{" "}
              {fmtDate(run.finishedAt)} · mw {run.matchweek ?? "—"}
            </>
          ) : (
            <>
              <span className="inline-block size-1.5 rounded-full bg-muted-foreground" />
              pipeline status unavailable
            </>
          )}
        </p>
      </div>
    </footer>
  );
}
