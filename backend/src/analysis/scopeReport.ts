import type { AnalysisReport } from "./types";

type MonthKeyedRow = { month?: string; monthKey?: string; date?: string };

function matchesMonth(row: MonthKeyedRow, monthKey: string, monthLabel?: string): boolean {
  if (row.monthKey === monthKey) return true;
  if (monthLabel && row.month === monthLabel) return true;
  if (row.date?.startsWith(monthKey)) return true;
  return false;
}

function filterMonthRows<T extends MonthKeyedRow>(
  rows: T[] | undefined,
  monthKey: string,
  monthLabel?: string,
): T[] {
  if (!rows?.length) return [];
  return rows.filter((row) => matchesMonth(row, monthKey, monthLabel));
}

/** Return a report view scoped to a single calendar month (YYYY-MM). */
export function scopeReportByMonth(report: AnalysisReport, monthKey: string): AnalysisReport {
  const allMonths = report.momSummary || report.metrics || [];
  const months = allMonths.filter((m) => m.monthKey === monthKey);

  if (!months.length) {
    return { ...report, viewScope: { mode: "monthly", monthKey, monthLabel: monthKey } };
  }

  const monthLabel = months[0].month;

  return {
    ...report,
    viewScope: { mode: "monthly", monthKey, monthLabel },
    metrics: months,
    momSummary: months,
    tradeCredits: filterMonthRows(report.tradeCredits, monthKey, monthLabel),
    tradeDebits: filterMonthRows(report.tradeDebits, monthKey, monthLabel),
    transactions: (report.transactions || []).filter(
      (txn) => txn.monthKey === monthKey || txn.month === monthLabel,
    ),
    applicant: {
      ...report.applicant,
      period: monthLabel,
    },
  };
}

export function listReportMonthKeys(report: AnalysisReport): string[] {
  const months = report.momSummary || report.metrics || [];
  return months.map((m) => m.monthKey).filter(Boolean);
}
