import { createFileRoute, redirect } from "@tanstack/react-router";
import { ReportLayout } from "@/components/report/ReportLayout";
import { getLatestAnalysisId, getLatestReport } from "@/lib/analysis-report-store";

export const Route = createFileRoute("/report")({
  beforeLoad: ({ location }) => {
    if (typeof window === "undefined") return;

    const searchId = new URLSearchParams(location.search).get("id");
    const id = searchId || getLatestAnalysisId();
    if (!id && !getLatestReport()) {
      throw redirect({ to: "/upload" });
    }
  },
  head: () => ({ meta: [{ title: "Party Ledger Report — RMH.PLA" }] }),
  component: ReportLayout,
});
