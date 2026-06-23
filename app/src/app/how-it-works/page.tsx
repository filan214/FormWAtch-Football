import type { Metadata } from "next";
import Link from "next/link";

import { FdrGate } from "@/components/how/fdr-gate";
import { NoiseLab } from "@/components/how/noise-lab";
import { PipelineFlow } from "@/components/how/pipeline-flow";
import { PosteriorPlayground } from "@/components/how/posterior-playground";
import { SeverityBuilder } from "@/components/how/severity-builder";
import { TypeExplorer } from "@/components/how/type-explorer";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "An interactive tour of FormWatch: why naive stats cry wolf, how Bayesian posteriors separate form from noise, and how the FDR gate keeps the anomaly board honest.",
};

function Chapter({
  n,
  title,
  lede,
  children,
}: {
  n: string;
  title: React.ReactNode;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-20">
      <div className="flex items-baseline gap-4">
        <span className="font-display text-3xl font-bold text-primary/60 sm:text-4xl">
          {n}
        </span>
        <h2 className="font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl">
          {title}
        </h2>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
        {lede}
      </p>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="rise border-b border-border pb-10">
        <p className="microlabel">The guided tour · no maths degree required</p>
        <h1 className="mt-2 max-w-3xl font-display text-5xl font-bold uppercase leading-[0.95] tracking-tight sm:text-7xl">
          How form<span className="text-primary">Watch</span>
          <br />
          works
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Every anomaly on the board survived a gauntlet: a weekly data
          pipeline, three statistical detectors, and a false-discovery gate.
          This page walks the gauntlet with interactive toys — drag the
          sliders, run the simulations, and the system explains itself. For
          the full statistical treatment, the{" "}
          <Link
            href="/methodology"
            className="text-primary transition-colors hover:underline"
          >
            methodology page
          </Link>{" "}
          goes deeper.
        </p>
      </header>

      <Chapter
        n="01"
        title="The weekly machine"
        lede="FormWatch is a pipeline, not a spreadsheet. Every Tuesday morning it wakes up, looks at the weekend's matches, and re-judges the entire league. Click each stage to see what happens inside."
      >
        <PipelineFlow />
      </Chapter>

      <Chapter
        n="02"
        title="Why your eyes lie"
        lede="Here is a striker who never changes: every match is a random draw at exactly 0.45 goals per 90 — a perfectly consistent player having a perfectly normal season. Watch what a naive “compare recent average to season average” detector does with that."
      >
        <NoiseLab />
      </Chapter>

      <Chapter
        n="03"
        title="Two beliefs per player"
        lede="The engine keeps two probability distributions for every player and metric: a slow belief built from full history, and a fast belief about the last six matches. A form change is real only when the two beliefs genuinely disagree. Drag the recent form and watch — and notice how the same hot streak means different things for different players."
      >
        <PosteriorPlayground />
      </Chapter>

      <Chapter
        n="04"
        title="The bouncer at the door"
        lede="Nomination is cheap — judgement is not. Each week, every nominated candidate's p-value lines up against the Benjamini-Hochberg threshold, and only those under the line make the board. This is the step most “form” stats skip, and it is the difference between a signal and a slot machine."
      >
        <FdrGate />
      </Chapter>

      <Chapter
        n="05"
        title="How loud is the alarm"
        lede="Survivors get a severity from 0 to 100, built from three capped parts: how far the beliefs separated, how many consecutive weeks the signal persisted, and how comfortably it cleared the gate. This is the exact production formula — move the sliders."
      >
        <SeverityBuilder />
      </Chapter>

      <Chapter
        n="06"
        title="Six kinds of stories"
        lede="A flag without a story is just a number. The direction of the deviation — which metrics moved, and which way — classifies every anomaly into one of six types, each with its own narrative angle."
      >
        <TypeExplorer />
      </Chapter>

      <div className="mt-20 flex flex-wrap gap-3 border-t border-border pt-8">
        <Link
          href="/"
          className="microlabel rounded-sm border border-primary/50 bg-primary/10 px-4 py-2.5 text-primary transition-colors hover:bg-primary/20"
        >
          see the live board →
        </Link>
        <Link
          href="/methodology"
          className="microlabel rounded-sm border border-border bg-card px-4 py-2.5 transition-colors hover:bg-accent hover:text-foreground"
        >
          read the full methodology →
        </Link>
      </div>
    </div>
  );
}
