import type { ExtractedStatement, NormalizedTransaction } from "./types";

export const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function toDate(value: string | Date): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = String(value || "").trim();
  const native = new Date(text);
  if (!Number.isNaN(native.getTime())) return native;

  const match = text.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,}|\d{1,2})[-/\s](\d{2,4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const monthRaw = match[2].toLowerCase();
  const month = /^\d+$/.test(monthRaw)
    ? Number(monthRaw) - 1
    : monthNames.findIndex((name) => name.toLowerCase() === monthRaw.slice(0, 3));
  let year = Number(match[3]);
  if (year < 100) year += year <= 69 ? 2000 : 1900;

  const parsed = new Date(Date.UTC(year, month, day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function money(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function formatINR(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 10000000) return `${sign}Rs ${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${sign}Rs ${(abs / 100000).toFixed(2)} L`;
  return `${sign}Rs ${Math.round(abs).toLocaleString("en-IN")}`;
}

export function formatDisplayDate(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const parsed = date instanceof Date ? date : toDate(date);
  if (!parsed) return String(date);
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const month = monthNames[parsed.getUTCMonth()];
  const year = parsed.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

const IFSC_BANK_PREFIX: Record<string, string> = {
  IDFB: "IDFC FIRST BANK",
  IDFC: "IDFC FIRST BANK",
  HDFC: "HDFC BANK",
  ICIC: "ICICI BANK",
  SBIN: "STATE BANK OF INDIA",
  PUNB: "PUNJAB NATIONAL BANK",
  KKBK: "KOTAK MAHINDRA BANK",
  UTIB: "AXIS BANK",
  BARB: "BANK OF BARODA",
};

function inferBankFromIfsc(ifsc: string): string | null {
  const code = ifsc.trim().toUpperCase().slice(0, 4);
  return IFSC_BANK_PREFIX[code] ?? null;
}

function inferBankFromFileName(fileName?: string): string | null {
  if (!fileName) return null;
  const upper = fileName.toUpperCase();
  if (/IDFC/.test(upper)) return "IDFC FIRST BANK";
  if (/HDFC/.test(upper)) return "HDFC BANK";
  if (/ICICI/.test(upper)) return "ICICI BANK";
  if (/KOTAK/.test(upper)) return "KOTAK MAHINDRA BANK";
  if (/PNB|PUNJAB NATIONAL/.test(upper)) return "PUNJAB NATIONAL BANK";
  if (/SBI|STATE BANK/.test(upper)) return "STATE BANK OF INDIA";
  if (/AXIS/.test(upper)) return "AXIS BANK";
  if (/IDBI/.test(upper)) return "IDBI BANK";
  return null;
}

export function monthLabel(date: Date): string {
  return `${monthNames[date.getUTCMonth()]}-${String(date.getUTCFullYear()).slice(-2)}`;
}

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const groupKey = key(item);
    acc[groupKey] = acc[groupKey] || [];
    acc[groupKey].push(item);
    return acc;
  }, {});
}

export function getInfo(statement: ExtractedStatement | undefined, label: RegExp): string {
  return statement?.accountInfo?.find((entry) => label.test(entry.label))?.value || "";
}

export function extractNameFromFileName(fileName?: string): string | null {
  if (!fileName) return null;
  const base = fileName.replace(/\.pdf$/i, "").trim();
  const titled =
    base.match(/(?:^|_)(MR\.?\s+[A-Za-z][A-Za-z.\s]{2,80})$/i) ||
    base.match(/(?:^|_)(MRS\.?\s+[A-Za-z][A-Za-z.\s]{2,80})$/i) ||
    base.match(/(?:^|_)(MS\.?\s+[A-Za-z][A-Za-z.\s]{2,80})$/i) ||
    base.match(/(?:^|_)(M\/S\.?\s+[A-Za-z0-9][A-Za-z0-9.\s&]{2,80})$/i);
  if (titled?.[1]) return titled[1].replace(/\s+/g, " ").trim();
  return null;
}

export function resolveAccountHolderName(
  statement: ExtractedStatement | undefined,
  applicantName?: string,
): string {
  const fromInfo =
    getInfo(statement, /^account name$/i) ||
    getInfo(statement, /customer name/i) ||
    getInfo(statement, /account holder/i);
  if (fromInfo) {
    const trimmed = fromInfo.trim();
    if (!/^address$/i.test(trimmed) && trimmed.length > 3) return trimmed;
  }

  const fromFile = extractNameFromFileName(statement?.fileName);
  if (fromFile) return fromFile;

  if (applicantName?.trim()) return applicantName.trim();
  return "Applicant";
}

export function formatBankDisplayName(raw: string): string {
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

export function accountNumberSuffix(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  const cleaned = accountNumber.trim();
  return cleaned.length > 0 ? cleaned.slice(-4) : "0000";
}

export function accountId(statement: ExtractedStatement, index: number): string {
  return getInfo(statement, /account number/i) || statement.fileName || `Account ${index + 1}`;
}

export function bankName(statement: ExtractedStatement): string {
  const direct =
    getInfo(statement, /^bank name$/i) ||
    getInfo(statement, /^bank$/i) ||
    getInfo(statement, /bank name/i);
  if (direct && !/^unknown/i.test(direct) && direct.length < 80) {
    const normalized = direct.replace(/\s+/g, " ").trim();
    const firstSegment = normalized.split(",")[0]?.trim() || normalized;
    return formatBankDisplayName(firstSegment);
  }

  const ifsc = getInfo(statement, /ifsc/i);
  const fromIfsc = inferBankFromIfsc(ifsc);
  if (fromIfsc) return formatBankDisplayName(fromIfsc);

  const fromFile = inferBankFromFileName(statement.fileName);
  if (fromFile) return formatBankDisplayName(fromFile);

  const branch = getInfo(statement, /branch/i);
  if (/IDFC/i.test(branch)) return formatBankDisplayName("IDFC FIRST BANK");

  const loose = getInfo(statement, /bank/i);
  if (loose && loose.length < 80 && !/tower|complex|mumbai|address|branch/i.test(loose)) {
    return formatBankDisplayName(loose);
  }

  return fromFile ? formatBankDisplayName(fromFile) : "Unknown Bank";
}

export function totalBy(transactions: NormalizedTransaction[], field: "credit" | "debit" | "amount"): number {
  return round(transactions.reduce((sum, txn) => sum + txn[field], 0));
}
