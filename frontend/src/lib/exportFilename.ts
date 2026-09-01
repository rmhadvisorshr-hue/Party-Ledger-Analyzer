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

function formatBankDisplayName(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "Bank";
  const upper = text.toUpperCase();
  if (upper.includes("HDFC")) return "HDFC Bank Ltd";
  if (upper.includes("IDFC")) return "IDFC First Bank";
  if (upper.includes("ICICI")) return "ICICI Bank";
  if (upper.includes("AXIS") || upper.includes("UTIB")) return "Axis Bank";
  if (upper.includes("SBI") || upper.includes("STATE BANK")) return "State Bank of India";
  if (upper.includes("KOTAK") || upper.includes("KKBK")) return "Kotak Mahindra Bank";
  if (upper.includes("BARODA") || upper.includes("BARB")) return "Bank of Baroda";
  if (upper.includes("UNION")) return "Union Bank of India";
  if (upper.includes("IDBI")) return "IDBI Bank";
  return text;
}

function accountNumberSuffix(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  const cleaned = accountNumber.trim();
  return cleaned.length > 0 ? cleaned.slice(-4) : "0000";
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
