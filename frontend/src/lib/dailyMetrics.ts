import { dateToMonthKey, type MonthKeyed } from "@/lib/period";

export type TransactionLike = MonthKeyed & {
  dateText?: string;
  credit?: number;
  debit?: number;
};

export type DailyFlowPoint = {
  day: string;
  label: string;
  totalCredits: number;
  totalDebits: number;
  netFlow: number;
  txnCount: number;
};

export type MomLike = {
  month?: string;
  monthKey?: string;
  openingBal?: number;
  closingBal?: number;
  totalCredits?: number;
  totalDebits?: number;
  netFlow?: number;
  cashDeposits?: number;
  cashWithdrawals?: number;
  upiCredit?: number;
  upiDebit?: number;
  abb?: number;
};

function txnDate(txn: TransactionLike): string {
  return (txn.dateText ?? txn.date ?? "").trim();
}

function txnMonthKey(txn: TransactionLike): string | null {
  if (txn.monthKey) return txn.monthKey;
  const d = txnDate(txn);
  return d ? dateToMonthKey(d) : null;
}

function formatDayLabel(isoDay: string): string {
  const d = new Date(`${isoDay}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDay.slice(8) || isoDay;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function buildDailyFlow(
  transactions: TransactionLike[],
  monthKey: string,
): DailyFlowPoint[] {
  const byDay = new Map<string, { credits: number; debits: number; count: number }>();

  for (const txn of transactions) {
    if (txnMonthKey(txn) !== monthKey) continue;
    const iso = txnDate(txn).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;

    const row = byDay.get(iso) ?? { credits: 0, debits: 0, count: 0 };
    row.credits += txn.credit ?? 0;
    row.debits += txn.debit ?? 0;
    row.count += 1;
    byDay.set(iso, row);
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({
      day,
      label: formatDayLabel(day),
      totalCredits: v.credits,
      totalDebits: v.debits,
      netFlow: v.credits - v.debits,
      txnCount: v.count,
    }));
}

/** Compact lakhs/crores ticks for chart axes (matches formatINR scale). */
export function chartAmountTick(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10_000_000) return `${(value / 10_000_000).toFixed(1)}Cr`;
  if (abs >= 100_000) return `${(value / 100_000).toFixed(0)}L`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(Math.round(value));
}

export const chartTooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
} as const;
