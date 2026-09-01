import type { MonthMetric, NormalizedTransaction } from "./types";
import { groupBy, round } from "./utils";

export function buildMonthMetrics(transactions: NormalizedTransaction[]): MonthMetric[] {
  return Object.entries(groupBy(transactions, (txn) => txn.monthKey))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, rows]) => {
      const first = rows[0];
      const last = rows[rows.length - 1];
      const credits = rows.reduce((sum, txn) => sum + txn.credit, 0);
      const debits = rows.reduce((sum, txn) => sum + txn.debit, 0);
      const balances = rows.map((txn) => txn.balance).filter((value): value is number => value !== null);
      const openingBal = first.balance == null ? 0 : first.balance - first.credit + first.debit;
      const upiCredits = rows
        .filter((txn) => txn.mode === "UPI" && txn.credit > 0)
        .reduce((sum, txn) => sum + txn.credit, 0);
      const upiDebits = rows
        .filter((txn) => txn.mode === "UPI" && txn.debit > 0)
        .reduce((sum, txn) => sum + txn.debit, 0);

      return {
        month: first.month,
        monthKey: first.monthKey,
        openingBal: round(openingBal),
        closingBal: round(last.balance ?? openingBal + credits - debits),
        totalCredits: round(credits),
        totalDebits: round(debits),
        netFlow: round(credits - debits),
        creditCount: rows.filter((txn) => txn.credit > 0).length,
        debitCount: rows.filter((txn) => txn.debit > 0).length,
        cashDeposits: round(rows.filter((txn) => txn.category === "Cash Deposit").reduce((sum, txn) => sum + txn.credit, 0)),
        cashWithdrawals: round(rows.filter((txn) => txn.category === "Cash Withdrawal").reduce((sum, txn) => sum + txn.debit, 0)),
        upiCredit: round(upiCredits),
        upiDebit: round(upiDebits),
        abb: round(balances.length ? balances.reduce((sum, value) => sum + value, 0) / balances.length : 0),
      };
    });
}
