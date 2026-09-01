import { cleanNarration, classifyCategory, classifyMode, extractParty } from "./classification";
import type { ExtractedStatement, NormalizedTransaction, TransactionDirection } from "./types";
import { accountId, bankName, money, monthKey, monthLabel, toDate } from "./utils";

export function normalizeTransactions(statements: ExtractedStatement[]): NormalizedTransaction[] {
  return statements
    .flatMap((statement, statementIndex) => {
      const account = accountId(statement, statementIndex);
      const bank = bankName(statement);

      return statement.transactions
        .map((raw, txnIndex): NormalizedTransaction | null => {
          const date = toDate(raw.date);
          if (!date) return null;

          const debit = money(raw.withdrawal);
          const credit = money(raw.deposit);
          if (debit === 0 && credit === 0) return null;

          const direction: TransactionDirection = credit >= debit ? "Credit" : "Debit";
          const narration = cleanNarration(raw.particulars || raw.narration || "TRANSACTION");

          return {
            id: `${statementIndex + 1}-${txnIndex + 1}`,
            date,
            dateText: date.toISOString().slice(0, 10),
            month: monthLabel(date),
            monthKey: monthKey(date),
            narration,
            debit,
            credit,
            amount: direction === "Credit" ? credit : debit,
            direction,
            balance: raw.balance == null || !Number.isFinite(Number(raw.balance)) ? null : Number(raw.balance),
            accountId: account,
            bankName: bank,
            party: extractParty(narration),
            mode: classifyMode(narration),
            category: classifyCategory(narration, direction),
          };
        })
        .filter((txn): txn is NormalizedTransaction => txn !== null);
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}
