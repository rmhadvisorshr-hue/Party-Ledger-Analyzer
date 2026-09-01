import { Outlet, useRouterState } from "@tanstack/react-router";
import { Brand, BackToDashboard } from "@/components/site-chrome";
import { ThemeToggle } from "@/components/theme-toggle";
import { applicant, accountInfo } from "@/data/reportData";
import { getAnalysis } from "@/lib/api";
import { useLatestReportVersion } from "@/lib/analysis-report-store";
import { getLatestAnalysisId, getLatestReport, saveLatestReport } from "@/lib/analysis-report-store";
import { useEffect } from "react";
import { PeriodProvider } from "@/contexts/PeriodContext";
import { PeriodSelector } from "@/components/report/PeriodSelector";

export function ReportLayout() {
  useLatestReportVersion();
  const location = useRouterState({ select: (r) => r.location });
  const primaryBank =
    applicant.banks?.[0]?.name || accountInfo?.bank || "";
  const primaryAccount =
    applicant.banks?.[0]?.account || accountInfo?.accountNumber || "";
  const accountSummary =
    primaryBank && primaryAccount
      ? `${primaryBank} · …${primaryAccount.slice(-4)}`
      : primaryBank || "";

  useEffect(() => {
    if (typeof window === "undefined") return;

    const searchId = new URLSearchParams(window.location.search).get("id");
    const analysisId = searchId || getLatestAnalysisId();
    const cachedReport = getLatestReport();

    if (!analysisId || cachedReport) {
      return;
    }

    let cancelled = false;

    void getAnalysis(analysisId)
      .then((result) => {
        if (cancelled || !result.report) return;
        saveLatestReport(result.id, result.report);
      })
      .catch(() => {
        // Report stays on cached data if the backend is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  return (
    <PeriodProvider>
      <div className="min-h-screen bg-background text-foreground">
        {/* TOP HEADER */}
        <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
          <div className="flex items-center gap-3 md:gap-6 px-3 md:px-5 py-2.5 md:py-3">
            <Brand compact />
            <BackToDashboard />
            <div className="hidden md:flex flex-col leading-tight min-w-0">
              <div className="font-display text-sm font-semibold truncate">{applicant.name}</div>
              <div className="text-[11px] text-muted-foreground font-mono truncate">
                {applicant.analysisId} · {applicant.period}
                {accountSummary ? ` · ${accountSummary}` : ""}
              </div>
            </div>
            <div className="hidden xl:flex items-center gap-3 ml-2 text-[11px]">
              {applicant.banks.map(b => (
                <span key={b.account} className="font-mono text-muted-foreground border border-border rounded px-2 py-1">
                  {b.name.split(" ")[0]}·{b.account.slice(-4)}
                </span>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-2 md:gap-3">
              <PeriodSelector className="hidden lg:flex" />
              <ThemeToggle />
            </div>
          </div>

          <div className="lg:hidden border-t border-border px-3 py-2">
            <PeriodSelector />
          </div>

          {/* mobile applicant strip */}
          <div className="md:hidden border-t border-border px-3 py-2 text-[11px]">
            <div className="min-w-0">
              <div className="font-medium truncate">{applicant.name}</div>
              <div className="text-muted-foreground font-mono truncate">
                {applicant.analysisId} · {applicant.period}
                {accountSummary ? ` · ${accountSummary}` : ""}
              </div>
            </div>
          </div>
        </header>

        <main className="min-w-0">
          <div className="p-4 sm:p-6 md:p-8 max-w-5xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </PeriodProvider>
  );
}
