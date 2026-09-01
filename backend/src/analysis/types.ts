export type TransactionDirection = "Credit" | "Debit";

export type ExtractedTransaction = {
  date: string | Date;
  particulars?: string;
  narration?: string;
  withdrawal?: number | null;
  deposit?: number | null;
  balance?: number | null;
};

export type ExtractedStatement = {
  fileName?: string;
  accountInfo?: { label: string; value: string }[];
  transactions: ExtractedTransaction[];
};

export type AnalysisInput = {
  applicantName?: string;
  entityType?: string;
  pan?: string;
  loanType?: string;
  statements: ExtractedStatement[];
};

export type NormalizedTransaction = {
  id: string;
  date: Date;
  dateText: string;
  month: string;
  monthKey: string;
  narration: string;
  debit: number;
  credit: number;
  amount: number;
  direction: TransactionDirection;
  balance: number | null;
  accountId: string;
  bankName: string;
  party: string;
  mode: string;
  category: string;
  customParty?: string;
  aiParty?: string;
  aiCounterPartyLedger?: string;
  aiPartyConfidence?: number;
  /** Soft-deleted from ledger grouping via the party manager panel; the underlying
   * transaction record is untouched. Set by hydrateReport(), never stored on the
   * in-memory report itself. */
  excludedFromLedger?: boolean;
};

export type MonthMetric = {
  month: string;
  monthKey: string;
  openingBal: number;
  closingBal: number;
  totalCredits: number;
  totalDebits: number;
  netFlow: number;
  creditCount: number;
  debitCount: number;
  cashDeposits: number;
  cashWithdrawals: number;
  upiCredit: number;
  upiDebit: number;
  abb: number;
};

export type ReportViewScope = {
  mode: "yearly" | "monthly";
  statementGranularity?: "yearly" | "monthly";
  monthKey?: string;
  monthLabel?: string;
  monthCount?: number;
};

export interface AnalysisReport {
  id?: string;
  source?: string;
  viewScope?: ReportViewScope;
  availableMonths?: string[];
  accountInfo?: {
    accountName: string;
    accountNumber: string;
    bank: string;
  };
  statementPeriod?: {
    startDate: string;
    endDate: string;
  };
  applicant?: {
    name: string;
    pan: string;
    entityType: string;
    loanType: string;
    analysisId: string;
    period: string;
    banks: Array<{ name: string; account: string; ifsc: string; branch: string }>;
  };
  momSummary?: MonthMetric[];
  tradeCredits?: Array<{ date: string; party: string; amount: number; mode: string; narration: string }>;
  tradeDebits?: Array<{ date: string; party: string; amount: number; mode: string; narration: string }>;
  transactions?: NormalizedTransaction[];
  metrics?: MonthMetric[];
}
