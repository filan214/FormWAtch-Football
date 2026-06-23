import type { Metadata } from "next";
import Link from "next/link";

import { TypeBadge } from "@/components/type-badge";
import { fetchExampleAnomalies } from "@/db/queries";
import { TYPE_META } from "@/lib/anomaly";
import { ANOMALY_TYPES } from "@/types/insight";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How FormWatch separates real form changes from noise: Gamma-Poisson posteriors, PELT change points, Mahalanobis profiling and Benjamini-Hochberg FDR control, backtested on the 2024-25 EPL season.",
};

function SectionHeading({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <h2 className="mt-16 flex items-baseline gap-4 font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl">
      <span className="text-primary/60">{n}</span>
      <span>{children}</span>
    </h2>
  );
}

function StatCallout({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-sm border border-border bg-card px-5 py-4">
      <p className="font-display text-4xl font-bold text-primary tnum">{value}</p>
      <p className="microlabel mt-1">{label}</p>
    </div>
  );
}

const TAXONOMY: Array<{ type: (typeof ANOMALY_TYPES)[number]; signature: string }> = [
  { type: "FORM_COLLAPSE", signature: "Output down and underlying numbers down — a genuine slump." },
  { type: "FINISHING_SLUMP", signature: "Goals down while xG holds — chances still arrive, finishing is cold." },
  { type: "BREAKOUT", signature: "Involvement breadth up, or goals and xG rising together — a new level." },
  { type: "OVERPERFORMANCE_RISK", signature: "Goals significantly above xG over the recent window — regression candidate." },
  { type: "WORKLOAD_SPIKE", signature: "Trailing 35-day minutes load far above the player's own norm." },
  { type: "ROLE_CHANGE", signature: "A change point plus a shifted involvement profile — shape, not output." },
];

export default async function MethodologyPage() {
  const examples = await fetchExampleAnomalies();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="rise border-b border-border pb-10">
        <p className="microlabel">The write-up</p>
        <h1 className="mt-2 max-w-3xl font-display text-5xl font-bold uppercase leading-[0.95] tracking-tight sm:text-7xl">
          Separating form
          <br />
          from <span className="text-primary">noise</span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Football form is debated constantly and quantified almost never.
          This page documents how FormWatch decides that a player&#39;s
          numbers have genuinely moved — the statistics, the tuning, the
          backtest, and the honest list of what it cannot see.
        </p>
      </header>

      <article className="prose-fw">
        <SectionHeading n="01">The problem: 90 minutes is a tiny sample</SectionHeading>
        <p>
          A striker takes three or four shots a game. A six-match window —
          the span pundits call &ldquo;recent form&rdquo; — contains maybe
          two goals&#39; worth of expectation. At that sample size almost any
          metric will wander violently for purely random reasons, and a
          detector that doesn&#39;t respect this drowns you in false alarms.
        </p>
        <p>
          FormWatch keeps a deliberately naive control detector to make the
          point concrete: a rolling z-score that compares the last 3 matches
          against a 10-match baseline and flags anything beyond{" "}
          <code>|z| ≥ 2</code>. It has no concept of sample size, breaks on
          zero-variance baselines, and tests every player on every metric
          every week — a multiple-testing machine with no correction. Its
          verdict is stored alongside every real detection and shown on each
          anomaly page, so the comparison is permanent and inspectable.
        </p>

        <SectionHeading n="02">Detector A — Gamma-Poisson posteriors</SectionHeading>
        <p>
          The core engine models each count metric — goals, shots, key
          passes, with xG and xG buildup treated as quasi-counts — as a
          Poisson process whose per-90 rate λ carries a Gamma prior. Thanks
          to conjugacy, every qualifying appearance updates the posterior in
          closed form. Two posteriors are maintained per player and metric:
          a slow-moving <strong>baseline</strong> built from full history,
          and a <strong>recent-form</strong> posterior over the last six
          matches, exponentially weighted toward the newest.
        </p>
        <p>
          An anomaly is nominated when the two 90% credible intervals stop
          overlapping, or when the KL divergence between the posteriors
          exceeds 1.5. The Bayesian machinery is what makes the system
          adaptive: a veteran with 200 appearances has a tight prior, so a
          modest dip is detectable by matchweek 2; a newly promoted player
          starts from a weakly informative prior (α=1, β=1) and the system
          deliberately withholds judgment until evidence accumulates.
          Posteriors carry across seasons — last season&#39;s ending belief
          becomes this season&#39;s opening prior, which is precisely what a
          rolling average cannot do.
        </p>

        <SectionHeading n="03">Detector B — change points</SectionHeading>
        <p>
          Where Detector A asks <em>is the recent window different?</em>,
          the second detector asks <em>did the series split into regimes,
          and where?</em> Each player&#39;s per-90 involvement metrics are
          z-scored over their own history and averaged into one composite
          index — the line drawn on every player timeline here. PELT with an
          RBF cost runs over that signal with a minimum segment of 4 matches,
          so a single big game can never constitute a regime.
        </p>
        <p>
          The penalty parameter was tuned by backtest, not taste: the
          textbook-ish <code>pen=5</code> found essentially no regimes on
          real composite signals (their standard deviation is only ~0.6),
          while <code>pen=1.5</code> recovers documented tactical shifts and
          stays silent on stationary noise.
        </p>

        <SectionHeading n="04">Detector C — typing the anomaly</SectionHeading>
        <p>
          A flag without a story is just a number. The third layer measures
          the <em>direction</em> of the deviation: Mahalanobis distance
          between the recent involvement profile and the player&#39;s
          historical centroid decides whether the shape of their game moved,
          and the combination of which metrics fired — and which way —
          classifies the anomaly:
        </p>
        <div className="my-6 space-y-2">
          {TAXONOMY.map(({ type, signature }) => (
            <div
              key={type}
              className="flex flex-col gap-1.5 rounded-sm border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
            >
              <span className="w-52 shrink-0">
                <TypeBadge type={type} size="sm" />
              </span>
              <span className="text-sm text-muted-foreground">{signature}</span>
            </div>
          ))}
        </div>
        <p>
          One precedence rule worth noting: the BREAKOUT type has two routes.
          The original gate demanded breadth — at least two involvement
          metrics up together. The backtest revealed that pure-striker surges
          (Alexander Isak, Jean-Philippe Mateta in 2024-25) move goals and xG
          together <em>without</em> touching the involvement metrics, and
          produced zero candidates. A second route — goals and xG both
          posterior-flagged up — fixed it. That single change, plus cleaning
          the validation list, took backtest recall from 33% to 82%.
        </p>

        <SectionHeading n="05">The gate: false discovery control</SectionHeading>
        <p>
          Around 300 players are eligible in a given week and five metrics
          are tested for each — well over a thousand hypotheses. Without
          correction, even a 1% per-test false-positive rate would flood the
          board. So nomination and judgment are separated:{" "}
          <strong>KL nominates, FDR gates</strong>. The KL threshold stays
          deliberately cheap (1.5), and every nominated candidate&#39;s
          p-value goes through Benjamini-Hochberg across the whole week at{" "}
          <code>q = 0.15</code>. Honest p-values around 0.5 — and KL-flagged
          junk produces plenty — die instantly under BH.
        </p>
        <p>
          Survivors get a severity score built from three capped components:
        </p>
        <div className="my-6 rounded-sm border border-border bg-card px-5 py-4 font-mono text-sm leading-relaxed text-foreground/85">
          severity = 40 · min(KL / 3, 1)
          <br />
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; + 30 · min(weeks
          / 3, 1)
          <br />
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; + 30 · (1 −
          min(p / 0.15, 1))
        </div>
        <p>
          — posterior separation, persistence across consecutive weekly
          runs, and how comfortably the FDR-adjusted p-value cleared the
          gate. The public board defaults to severity ≥ 60; the full list
          sits one filter away. ROLE_CHANGE is the one type that bypasses
          FDR — it has no natural p-value, so the conservative PELT penalty
          acts as its significance gate.
        </p>

        <SectionHeading n="06">Backtested on 2024-25</SectionHeading>
        <p>
          Before going live, the full stack replayed the 2024-25 season at 28
          weekly evaluation dates with no lookahead, scored against a
          premise-checked list of the season&#39;s famous form stories —
          eleven cases where the story is actually visible as a per-90
          contrast in the data. Configurations were searched over the KL
          threshold, the PELT penalty and the FDR level.
        </p>
        <div className="my-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCallout value="9/11" label="known anomalies recalled (82%)" />
          <StatCallout value="5" label="median anomalies per week, sev ≥ 60" />
          <StatCallout value="8" label="p90 anomalies per week" />
          <StatCallout value="28" label="weekly replays, no lookahead" />
        </div>
        <p>
          The hits behave the way severity is meant to: Erling Haaland&#39;s
          winter drought flagged for 7 consecutive weeks peaking at severity
          91; Marcus Rashford&#39;s Villa loan surge ran 11 weeks and reached
          97; Isak and Mateta — the cases that motivated the second BREAKOUT
          route — peaked at 80 and 87. The two misses are documented rather
          than excused: Chris Wood&#39;s chronic overperformance was visible
          from matchday 1, so his own baseline absorbed it; Eberechi
          Eze&#39;s gradual late-season surge never produced a p-value small
          enough to clear BH against a rising baseline.
        </p>
        <p>
          The full backtest — premise checks, the dropped cases and why,
          per-case outcomes and the grid — is documented in{" "}
          <code>pipeline/BACKTEST.md</code> in the repository, and is
          reproducible with one command.
        </p>

        <SectionHeading n="07">What it cannot see (yet)</SectionHeading>
        <p>
          <strong>Down-side power is fundamentally limited.</strong> A
          six-match scoreless window for a 0.5-goals/90 player has a Poisson
          tail probability floor around 0.03–0.04 — real droughts barely
          survive the FDR gate and rarely reach severity 60. Cole
          Palmer&#39;s slump was detected but maxed at severity 50. The fix
          (an evidence window that stretches with the drought) is designed
          but deferred. <strong>Chronic overperformance is invisible</strong>{" "}
          to recent-vs-baseline logic by construction — the Overperformers
          leaderboard exists precisely to cover that blind spot at season
          scale. <strong>Workload spikes lie dormant</strong> on this data:
          Understat records league minutes only, and Premier League
          scheduling alone never reaches 1.5× a player&#39;s median 35-day
          load — congestion comes from cups and Europe. And{" "}
          <strong>ROLE_CHANGE is experimental</strong>: no role-change story
          survived the backtest&#39;s premise check, so its precision is
          unvalidated; treat those flags as leads, not verdicts.
        </p>

        <SectionHeading n="08">See it live</SectionHeading>
        <p>
          Every claim above is one click from its evidence — current
          anomalies, their posteriors, credible intervals and FDR-adjusted
          p-values:
        </p>
      </article>

      {examples && examples.length > 0 ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {examples.map((e) => (
            <Link
              key={e.id}
              href={`/anomaly/${e.id}`}
              className="group rounded-sm border border-border bg-card px-4 py-4 transition-colors hover:bg-accent"
            >
              <div className="flex items-center justify-between gap-2">
                <TypeBadge type={e.anomalyType} size="sm" />
                <span
                  className="font-display text-2xl font-bold tnum"
                  style={{ color: TYPE_META[e.anomalyType].color }}
                >
                  {e.severity}
                </span>
              </div>
              <p className="mt-2 font-display text-xl font-semibold uppercase tracking-wide transition-colors group-hover:text-primary">
                {e.playerName}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          The live board is empty or offline right now — check the{" "}
          <Link href="/" className="text-primary hover:underline">
            anomaly board
          </Link>{" "}
          for current examples.
        </p>
      )}

      <footer className="mt-16 border-t border-border pt-6">
        <p className="microlabel max-w-3xl leading-relaxed">
          Stack: Understat data via soccerdata · scipy + ruptures +
          scikit-learn detectors · Supabase Postgres · weekly GitHub Actions
          pipeline · narratives by gemini-2.5-flash via OpenRouter, validated
          against a Zod schema and cached by evidence hash · this dashboard
          is Next.js + Drizzle + Recharts.
        </p>
      </footer>
    </div>
  );
}
