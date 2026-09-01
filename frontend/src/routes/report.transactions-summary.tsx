import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { Panel } from "@/components/report/primitives";
import { SectionHead } from "@/components/report/SectionHead";
import { ModuleExcelButton } from "@/components/report/ModuleExcelButton";
import { TransactionSummaryTable } from "@/components/report/TransactionSummaryTable";
import { PartyManagerPanel } from "@/components/report/PartyManagerPanel";
import { Button } from "@/components/ui/button";
import { transactions, tradeCredits, tradeDebits } from "@/data/reportData";
import { excludeTransaction, listParties, updateTransactionPartyOverride, type PartySummary } from "@/lib/api";
import { moveTransactionsToParty, type MoveTarget } from "@/lib/partyMoveHelpers";
import { getLatestAnalysisId, saveLatestReport, useLatestReportVersion } from "@/lib/analysis-report-store";
import { usePeriodScope } from "@/contexts/PeriodContext";
import { filterByMonth, type MonthKeyed } from "@/lib/period";
import type { SummaryTxn } from "@/lib/transactionSummary";

function cleanGarbageFromText(text: string): string {
  if (!text) return "";
  let out = text;
  const patterns = [
    /STATEMENT PERIOD\s*:\s*\d{4}[-/]\d{2}[-/]\d{2}(?:\s+TO\s+\d{4}[-/]\d{2}[-/]\d{2})?/i,
    /STATEMENT PERIOD\s*:\s*\d{2}[-/]\d{2}[-/]\d{2,4}(?:\s+TO\s+\d{2}[-/]\d{2}[-/]\d{2,4})?/i,
    /OPENING BALANCE\s+TOTAL DEBIT\s+TOTAL CREDIT\s+CLOSING BALANCE\s*[\d,.\s-]*/i,
    /TOTAL DEBIT\s+TOTAL CREDIT\s+CLOSING BALANCE\s*[\d,.\s-]*/i,
    /TRANSACTION VALUE DATE PARTICULARS CHEQUE DEBIT CREDIT BALANCE DATE NO/i,
    /TRANSACTION VALUE DATE PARTICULARS/i,
    /CHEQUE DEBIT CREDIT BALANCE DATE NO/i,
    /VALUE DATE PARTICULARS CHEQUE DEBIT CREDIT BALANCE/i,
    /Opening Balance Total Debit Total Credit Closing Balance\s*[\d,.\s-]*/i,
    /Opening Balance Total Total Closing Balance\s*[\d,.\s-]*/i,
    /Transaction Value Date Particulars Cheque Debit Credit Balance Date No/i,
    /Value Date Particulars Cheque Debit Credit Balance/i,
    /\bValue Da\b/i
  ];
  for (const pattern of patterns) {
    out = out.replace(pattern, "");
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Mirrors the server's scopeReportByMonth so the on-screen table matches Excel/Ledger exports exactly. */
function scopeByPeriod<T extends MonthKeyed>(
  rows: T[],
  mode: string,
  monthKey: string,
  monthLabel: string,
): T[] {
  if (mode !== "monthly") return rows;
  return filterByMonth(rows, monthKey, monthLabel);
}

export const Route = createFileRoute("/report/transactions-summary")({
  component: TransactionSummaryPage,
});

function TransactionSummaryPage() {
  // Re-run whenever the canonical report changes (initial async load completing, or a
  // transaction edit coming back from the backend) and whenever the selected reporting
  // period changes, so this table is always derived fresh from the current source of
  // truth instead of a one-time snapshot taken at mount.
  const reportVersion = useLatestReportVersion();
  const { mode: periodMode, monthKey, monthLabel } = usePeriodScope();
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const scopedTxns = useMemo(() => {
    const hasDetailedTransactions = transactions.length > 0;

    const list: SummaryTxn[] = hasDetailedTransactions
      ? scopeByPeriod(transactions as SummaryTxn[], periodMode, monthKey, monthLabel)
      : [
          ...scopeByPeriod([...tradeCredits], periodMode, monthKey, monthLabel).map((t) => ({
            dateText: String(t.date ?? ""),
            party: String(t.party ?? ""),
            narration: String(t.narration ?? ""),
            debit: 0,
            credit: Number(t.amount || 0),
            amount: Number(t.amount || 0),
            direction: "Credit" as const,
            category: "Trade Credit",
          })),
          ...scopeByPeriod([...tradeDebits], periodMode, monthKey, monthLabel).map((t) => ({
            dateText: String(t.date ?? ""),
            party: String(t.party ?? ""),
            narration: String(t.narration ?? ""),
            debit: Number(t.amount || 0),
            credit: 0,
            amount: Number(t.amount || 0),
            direction: "Debit" as const,
            category: "Trade Debit",
          })),
        ];

    return list.map((t, idx) => {
      const cleanParty = cleanGarbageFromText(t.party || "");
      const cleanNarration = cleanGarbageFromText(t.narration || "");
      return {
        ...t,
        party: cleanParty || "UNRECOGNIZED",
        narration: cleanNarration || "Transaction",
        id: t.id || `txn-${idx}`,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- transactions/tradeCredits/tradeDebits are live proxies read fresh on every reportVersion bump, not stable deps themselves.
  }, [reportVersion, periodMode, monthKey, monthLabel]);

  const excludedTransactions = useMemo(
    () => scopedTxns.filter((t) => t.excludedFromLedger),
    [scopedTxns],
  );

  const analysisId = getLatestAnalysisId();

  // Independent from the Manage Parties panel's own party list (it fetches its own copy on
  // the same reportVersion signal) -- this table-side copy powers the per-row Move picker
  // and the Modify dropdown's merged party list, so those work whether or not the panel is
  // open, without adding a shared-state dependency between the two components.
  const [parties, setParties] = useState<PartySummary[]>([]);
  useEffect(() => {
    if (!analysisId) return;
    let cancelled = false;
    listParties(analysisId)
      .then((res) => {
        if (!cancelled) setParties(res.parties);
      })
      .catch(() => {
        // Non-fatal: the picker still works with auto-detected names alone.
      });
    return () => {
      cancelled = true;
    };
  }, [analysisId, reportVersion]);

  const handleUpdateOverride = async (txnId: string, newParty: string | null) => {
    if (!analysisId) {
      alert("No analysis report found. Please upload and analyze a bank statement first.");
      return;
    }

    const normalizedParty = newParty?.trim() || null;
    try {
      const result = await updateTransactionPartyOverride({
        analysisId,
        transactionId: txnId,
        party: normalizedParty,
      });

      // The backend response carries the updated canonical report (with the override
      // applied). Saving it here bumps the report-store version, which re-runs the
      // useMemo above — the table, and every Excel/Ledger export after this point, now
      // all read from this exact same updated report. There is no separate local copy
      // of the override to keep in sync.
      if (result.report) {
        saveLatestReport(result.id, result.report);
      }
    } catch (error) {
      console.error("Failed to update transaction assignment:", error);
      alert(error instanceof Error ? error.message : "Could not update transaction assignment.");
    }
  };

  const handleExcludeTransaction = async (txnId: string) => {
    if (!analysisId) {
      alert("No analysis report found. Please upload and analyze a bank statement first.");
      return;
    }
    try {
      const result = await excludeTransaction(analysisId, txnId);
      if (result.report) saveLatestReport(result.id, result.report);
    } catch (error) {
      console.error("Failed to remove transaction from ledger:", error);
      alert(error instanceof Error ? error.message : "Could not remove transaction from ledger.");
    }
  };

  const toggleSelect = (txnId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(txnId)) next.delete(txnId);
      else next.add(txnId);
      return next;
    });
  };

  const handleBulkMove = async (target: MoveTarget, transactionIds: string[]) => {
    if (!analysisId || transactionIds.length === 0) return;
    try {
      const result = await moveTransactionsToParty({ analysisId, parties, target, transactionIds });
      if (result.report) saveLatestReport(result.id, result.report);
      setSelectedIds(new Set());
    } catch (error) {
      console.error("Failed to move transactions:", error);
      alert(error instanceof Error ? error.message : "Could not move the selected transactions.");
    }
  };

  return (
    <div className="space-y-6">
      <SectionHead
        code="00"
        title="Party Ledger (Counterparty Summary)"
        subtitle="Identify the actual counterparty across all payment modes and consolidate transactions under that party."
      />

      <Panel
        title="Transaction Summary (Party-wise)"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPanelOpen(true)} className="gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Manage Parties
            </Button>
            <ModuleExcelButton module="transactions-summary" label="Download Excel (Compact)" />
            <ModuleExcelButton
              module="transactions-summary-ca"
              label="Download Excel (CA Format)"
              variant="secondary"
            />
            <ModuleExcelButton
              module="transactions-ledger"
              label="Ledger Book (Compare)"
              variant="outline"
            />
          </div>
        }
      >
        {/* <p className="text-xs text-muted-foreground mb-4">
          Each row is a normalized counterparty (person, business, or entity). Transactions via UPI, IMPS, NEFT,
          RTGS, cheques, SI/ACH, card, cash, and other modes that belong to the same party are merged together.
          Bank metadata such as UTR/reference IDs, SWEEP/SETTLEMENT tags, and SI references are stripped out; only
          low-confidence rows remain in <span className="font-mono">UNRECOGNIZED</span>. Think of this as a Party
          Ledger Analysis Engine rather than a simple merchant categorization view.
        </p> */}
        <TransactionSummaryTable
          transactions={scopedTxns}
          onUpdateOverride={handleUpdateOverride}
          onExcludeTransaction={handleExcludeTransaction}
          selectedTransactionIds={selectedIds}
          onToggleSelect={toggleSelect}
          parties={parties}
          onBulkMove={handleBulkMove}
        />
      </Panel>

      <PartyManagerPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        analysisId={analysisId}
        reportVersion={reportVersion}
        onReportUpdated={saveLatestReport}
        selectedTransactionIds={[...selectedIds]}
        onClearSelection={() => setSelectedIds(new Set())}
        excludedTransactions={excludedTransactions}
      />
    </div>
  );
}
