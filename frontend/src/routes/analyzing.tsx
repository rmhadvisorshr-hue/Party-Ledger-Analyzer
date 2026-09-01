import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { getAnalysis } from "@/lib/api";
import { getLatestAnalysisId, saveLatestReport } from "@/lib/analysis-report-store";
import { BackToDashboard } from "@/components/site-chrome";

export const Route = createFileRoute("/analyzing")({
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search.id === "string" ? search.id : undefined,
  }),
  head: () => ({ meta: [{ title: "Analyzing - RMH.PLA" }] }),
  component: Analyzing,
});

const steps = [
  "Reading statement text and parsed transaction rows...",
  "Normalizing dates, debit, credit and balance columns...",
  "Resolving counterparties across UPI, IMPS, NEFT, RTGS, cheques and cash...",
  "Merging transactions under each party and flagging unrecognized rows...",
  "Consolidating totals per party and payment mode...",
  "Composing the one-page party ledger summary...",
];

function Analyzing() {
  const nav = useNavigate();
  const search = Route.useSearch();
  const analysisId = search.id || getLatestAnalysisId();
  const [i, setI] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setI((value) => Math.min(value + 1, steps.length)), 650);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!analysisId) {
      setError("No analysis id was found. Please upload a statement again.");
      return;
    }

    const id = analysisId;
    let cancelled = false;

    async function loadAnalysis() {
      try {
        const result = await getAnalysis(id);
        if (cancelled) return;

        if (result.report) {
          saveLatestReport(result.id, result.report);
        }

        setI(steps.length);
        setTimeout(() => {
          if (!cancelled) void nav({ to: "/report", search: { id: result.id } });
        }, 600);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load analysis.");
      }
    }

    void loadAnalysis();

    return () => {
      cancelled = true;
    };
  }, [analysisId, nav]);

  const pct = Math.min(100, Math.round((i / steps.length) * 100));

  return (
    <div className="min-h-screen bg-background relative overflow-hidden flex items-center justify-center">
      <div className="absolute inset-0 grid-bg opacity-20" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-primary/10 blur-3xl animate-pulse" />
      <div className="relative max-w-2xl w-full mx-auto px-6">
        <div className="mb-6"><BackToDashboard /></div>
        <div className="text-xs font-mono uppercase tracking-[0.2em] text-primary text-center">AI Analysis in progress</div>
        <h1 className="mt-4 font-display text-4xl md:text-5xl font-bold tracking-tight text-center">Reading between the lines.</h1>

        <div className="mt-12 rounded-xl border border-border bg-card/70 backdrop-blur p-8">
          <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
            <span>{analysisId || "NO-ANALYSIS"}</span>
            <span>{pct}%</span>
          </div>
          <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
            <motion.div className="h-full bg-gradient-to-r from-primary to-[color:var(--accent)]" animate={{ width: `${pct}%` }} transition={{ ease: "easeOut" }} />
          </div>
          <ul className="mt-8 space-y-3">
            {steps.map((step, idx) => {
              const state = idx < i ? "done" : idx === i ? "active" : "pending";
              return (
                <li key={step} className="flex items-start gap-3 text-sm">
                  <span className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${
                    state === "done" ? "bg-[color:var(--positive)]"
                    : state === "active" ? "bg-primary animate-pulse"
                    : "bg-muted"
                  }`} />
                  <span className={state === "pending" ? "text-muted-foreground/60" : state === "active" ? "text-foreground" : "text-muted-foreground line-through"}>
                    {step}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {error && (
          <div className="mt-6 rounded-md border border-[color:var(--risk-high)]/40 bg-[color:var(--risk-high)]/10 px-4 py-3 text-center text-sm text-[color:var(--risk-high)]">
            {error}
          </div>
        )}

        <div className="mt-6 text-center text-xs font-mono text-muted-foreground">Median analysis time - 90s - Your data stays in your backend</div>
      </div>
    </div>
  );
}
