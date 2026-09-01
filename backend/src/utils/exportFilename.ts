import type { ExtractedStatement } from "../analysis/types";
import {
  accountId,
  accountNumberSuffix,
  bankName,
  formatBankDisplayName,
  resolveAccountHolderName,
} from "../analysis/utils";

type ReportForExport = {
  applicant?: { name?: string; period?: string; banks?: Array<{ name?: string; account?: string }> };
  accountInfo?: { bank?: string; accountName?: string; accountNumber?: string };
  statementPeriod?: { startDate?: string; endDate?: string };
};

export function sanitizeFilenamePart(value: string, maxLen = 60): string {
  return (
    value
      .replace(/[<>:"/\\|?*]/g, " ")
      .replace(/\./g, "")
      .replace(/\s+/g, "_")
      .trim()
      .replace(/^_+|_+$/g, "")
      .slice(0, maxLen) || "Export"
  );
}

function sanitizeBankFilenamePart(value: string): string {
  const words = sanitizeFilenamePart(value, 60).split("_").filter(Boolean);
  const compact = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
  return compact || "Bank";
}

function formatDatePart(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return sanitizeFilenamePart(value, 20);
}

function periodParts(report: ReportForExport): { from: string; to: string } {
  const from = formatDatePart(report.statementPeriod?.startDate);
  const to = formatDatePart(report.statementPeriod?.endDate);
  if (from && to) return { from, to };
  return { from: "Period", to: "Period" };
}

function filenameBaseParts(report: ReportForExport): { client: string; bank: string; account: string; from: string; to: string } {
  const client = sanitizeFilenamePart(
    report.applicant?.name || report.accountInfo?.accountName || "Client",
  );
  const bank = sanitizeBankFilenamePart(
    formatBankDisplayName(report.accountInfo?.bank || report.applicant?.banks?.[0]?.name || "Bank"),
  );
  const account = sanitizeFilenamePart(
    accountNumberSuffix(report.accountInfo?.accountNumber || report.applicant?.banks?.[0]?.account || ""),
    12,
  );
  const { from, to } = periodParts(report);
  return { client, bank, account, from, to };
}

export function buildStatementExcelFilename(
  statement: Pick<ExtractedStatement, "accountInfo" | "fileName">,
  options?: { moduleLabel?: string },
): string {
  const pseudo: ExtractedStatement = {
    fileName: statement.fileName,
    accountInfo: statement.accountInfo,
    transactions: [],
  };
  const client = sanitizeFilenamePart(resolveAccountHolderName(pseudo));
  const bank = sanitizeFilenamePart(bankName(pseudo));
  const account = sanitizeFilenamePart(accountNumberSuffix(accountId(pseudo, 0)), 12);
  const modulePart = options?.moduleLabel
    ? `_${sanitizeFilenamePart(MODULE_FILENAME_LABELS[options.moduleLabel] ?? options.moduleLabel, 40)}`
    : "";
  return `${client}_${bank}_${account}${modulePart}.xlsx`;
}

/** Human-readable module slug for download filenames. */
export const MODULE_FILENAME_LABELS: Record<string, string> = {
  "transactions-summary": "Party_Analysis_Compact",
  "transactions-summary-ca": "Party_Analysis_CA",
  "transactions-ledger": "Ledger_Book",
  "transaction-summary": "Transaction_Summary",
};

export function buildExcelExportFilename(
  report: ReportForExport,
  options?: { moduleLabel?: string },
): string {
  const { client, bank, account, from, to } = filenameBaseParts(report);
  const modulePart = sanitizeFilenamePart(
    options?.moduleLabel ? (MODULE_FILENAME_LABELS[options.moduleLabel] ?? options.moduleLabel) : "Transaction_Summary",
    40,
  );
  const filename = `${client}_${bank}_${account}_${modulePart}_${from}_to_${to}.xlsx`;
  return filename.slice(0, 180);
}
