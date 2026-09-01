import { getLatestReport } from "@/lib/analysis-report-store";

type ReportLike = Record<string, unknown>;

const emptyApplicant = {
  name: "",
  pan: "",
  entityType: "",
  loanType: "",
  analysisId: "",
  analyst: "",
  period: "",
  banks: [] as { name: string; account: string; ifsc: string; branch: string }[],
};

const emptyAccountInfo = { accountName: "", accountNumber: "", bank: "" };
const emptyRiskScore = { value: 0, band: "", decision: "" as const, confidence: 0, trend: 0 };
const emptyAiRecommendation = { verdict: "", rationale: "", conditions: [] as string[] };
const emptySheet: Array<Array<string | number | null>> = [];

function currentReport(): ReportLike {
  const live = getLatestReport<ReportLike>();
  return live ?? {};
}

function resolvePath(path: string[]) {
  let value: unknown = currentReport();

  for (const key of path) {
    if (value === null || value === undefined) return undefined;
    value = (value as Record<string, unknown>)[key];
  }

  return value;
}

function liveValue<T>(path: string[], fallback: T): T {
  return new Proxy(fallback as object, {
    get(target, prop) {
      const value = resolvePath(path);

      if (prop === Symbol.iterator && Array.isArray(value)) {
        return value[Symbol.iterator].bind(value);
      }

      if (value !== null && value !== undefined && typeof value === "object" && prop in value) {
        const property = (value as Record<PropertyKey, unknown>)[prop];
        if (typeof property === "function") {
          return property.bind(value);
        }
        return property;
      }

      const fallbackValue = (target as Record<PropertyKey, unknown>)[prop];
      if (typeof fallbackValue === "function") {
        return fallbackValue.bind(target);
      }
      return fallbackValue;
    },
    has(_target, prop) {
      const value = resolvePath(path);
      return prop in Object((value ?? fallback) as Record<PropertyKey, unknown>);
    },
    ownKeys() {
      const value = resolvePath(path);
      return Reflect.ownKeys(Object(value ?? fallback));
    },
    getOwnPropertyDescriptor(_target, prop) {
      const value = resolvePath(path) as Record<PropertyKey, unknown> | undefined;
      const source = (value ?? fallback) as Record<PropertyKey, unknown>;
      return Object.getOwnPropertyDescriptor(Object(source), prop) ?? {
        configurable: true,
        enumerable: true,
        value: source[prop],
      };
    },
  }) as T;
}

export const applicant = liveValue(["applicant"], emptyApplicant);
export const accountInfo = liveValue(["accountInfo"], emptyAccountInfo);
export const riskScore = liveValue(["riskScore"], emptyRiskScore);
export const aiRecommendation = liveValue(["aiRecommendation"], emptyAiRecommendation);
export const flags = liveValue(["flags"], [] as typeof emptySheet);
export const flagsSheet = liveValue(["flagsSheet"], emptySheet);
export const execSummary = liveValue(["execSummary"], [] as Record<string, unknown>[]);
export const execSheet = liveValue(["execSheet"], emptySheet);
export const camAnalysis = liveValue(["camAnalysis"], [] as Record<string, unknown>[]);
export const camSheet = liveValue(["camSheet"], emptySheet);
export const momSummary = liveValue(["momSummary"], [] as Record<string, unknown>[]);
export const momSheet = liveValue(["momSheet"], emptySheet);
export const monthlyCF = liveValue(["monthlyCF"], [] as Record<string, unknown>[]);
export const monthlyCFSheet = liveValue(["monthlyCFSheet"], emptySheet);
export const bounces = liveValue(["bounces"], [] as Record<string, unknown>[]);
export const bounceSheet = liveValue(["bounceSheet"], emptySheet);
export const loans = liveValue(["loans"], [] as Record<string, unknown>[]);
export const loansSheet = liveValue(["loansSheet"], emptySheet);
export const emiTracker = liveValue(["emiTracker"], [] as Record<string, unknown>[]);
export const tradeCredits = liveValue(["tradeCredits"], [] as Record<string, unknown>[]);
export const tradeDebits = liveValue(["tradeDebits"], [] as Record<string, unknown>[]);
export const highestTns = liveValue(["highestTns"], [] as Record<string, unknown>[]);
export const internalGroup = liveValue(["internalGroup"], [] as Record<string, unknown>[]);
export const circular = liveValue(["circular"], [] as Record<string, unknown>[]);
export const netTransactions = liveValue(["netTransactions"], [] as Record<string, unknown>[]);
export const salary = liveValue(["salary"], [] as Record<string, unknown>[]);
export const staffEmoluments = liveValue(["staffEmoluments"], [] as Record<string, unknown>[]);
export const spendAnalysis = liveValue(["spendAnalysis"], [] as Record<string, unknown>[]);
export const billPayments = liveValue(["billPayments"], [] as Record<string, unknown>[]);
export const recurringDebit = liveValue(["recurringDebit"], [] as Record<string, unknown>[]);
export const recurringCredit = liveValue(["recurringCredit"], [] as Record<string, unknown>[]);
export const emiTrackerSheet = liveValue(["emiTrackerSheet"], emptySheet);
export const tradeCreditsSheet = liveValue(["tradeCreditsSheet"], emptySheet);
export const tradeDebitsSheet = liveValue(["tradeDebitsSheet"], emptySheet);
export const highestTnsSheet = liveValue(["highestTnsSheet"], emptySheet);
export const internalGroupSheet = liveValue(["internalGroupSheet"], emptySheet);
export const circularSheet = liveValue(["circularSheet"], emptySheet);
export const netTransactionsSheet = liveValue(["netTransactionsSheet"], emptySheet);
export const salarySheet = liveValue(["salarySheet"], emptySheet);
export const staffEmolumentsSheet = liveValue(["staffEmolumentsSheet"], emptySheet);
export const spendAnalysisSheet = liveValue(["spendAnalysisSheet"], emptySheet);
export const billPaymentsSheet = liveValue(["billPaymentsSheet"], emptySheet);
export const recurringDebitSheet = liveValue(["recurringDebitSheet"], emptySheet);
export const recurringCreditSheet = liveValue(["recurringCreditSheet"], emptySheet);
export const transactions = liveValue(["transactions"], [] as Record<string, unknown>[]);

export const formatINR = (n: number) => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  return `${sign}₹${abs.toLocaleString("en-IN")}`;
};
