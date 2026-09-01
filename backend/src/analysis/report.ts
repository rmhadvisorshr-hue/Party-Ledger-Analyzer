import { buildMonthMetrics } from "./metrics";
import { normalizeTransactions } from "./normalize";
import type { AnalysisInput, AnalysisReport } from "./types";
import { accountId, bankName, getInfo, resolveAccountHolderName } from "./utils";

export function analyzeBankStatements(input: AnalysisInput): AnalysisReport {
  const transactions = normalizeTransactions(input.statements);
  const months = buildMonthMetrics(transactions);
  const primaryStatement = input.statements[0];
  const accountName = resolveAccountHolderName(primaryStatement, input.applicantName);
  const accountNumber = primaryStatement ? accountId(primaryStatement, 0) : "-";
  const bank = primaryStatement ? bankName(primaryStatement) : "-";

  const statementStart = transactions[0]?.dateText ?? "-";
  const statementEnd = transactions[transactions.length - 1]?.dateText ?? "-";

  const applicantBanks = input.statements.map((statement, index) => ({
    name: bankName(statement),
    account: accountId(statement, index),
    ifsc: getInfo(statement, /ifsc/i) || "-",
    branch: getInfo(statement, /branch/i) || "-",
  }));

  return {
    viewScope: {
      mode: months.length <= 1 ? "monthly" : "yearly",
      statementGranularity: months.length <= 1 ? "monthly" : "yearly",
      monthCount: months.length,
    },
    availableMonths: months.map((m) => m.monthKey),
    accountInfo: {
      accountName,
      accountNumber,
      bank,
    },
    statementPeriod: {
      startDate: statementStart,
      endDate: statementEnd,
    },
    applicant: {
      name: accountName,
      pan: input.pan || "-",
      entityType: input.entityType || "-",
      loanType: input.loanType || "-",
      analysisId: `PLA-${new Date().getUTCFullYear()}-${String(Date.now()).slice(-7)}`,
      period: months.length ? `${months[0].month} to ${months[months.length - 1].month}` : "-",
      banks: applicantBanks,
    },
    metrics: months,
    momSummary: months,
    tradeCredits: transactions
      .filter((txn) => txn.category === "Trade Credit")
      .slice(0, 100)
      .map((txn) => ({
        date: txn.dateText,
        party: txn.party,
        amount: txn.credit,
        mode: txn.mode,
        narration: txn.narration,
      })),
    tradeDebits: transactions
      .filter((txn) => txn.category === "Trade Debit")
      .slice(0, 100)
      .map((txn) => ({
        date: txn.dateText,
        party: txn.party,
        amount: txn.debit,
        mode: txn.mode,
        narration: txn.narration,
      })),
    transactions,
  };
}
