import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { momSummary } from "@/data/reportData";
import { getLatestReport, useLatestReportVersion } from "@/lib/analysis-report-store";
import {
  type PeriodMode,
  type MonthOption,
  getMonthOptions,
  resolveMonthKey,
} from "@/lib/period";

const STORAGE_KEY = "bsa-period-scope";

type StoredScope = {
  mode: PeriodMode;
  monthKey: string;
};

type ReportViewScope = {
  statementGranularity?: "monthly" | "yearly";
  monthCount?: number;
};

type PeriodContextValue = {
  mode: PeriodMode;
  monthKey: string;
  monthLabel: string;
  monthCount: number;
  monthOptions: MonthOption[];
  /** False for single-month statements — only monthly view applies. */
  allowYearlyView: boolean;
  statementGranularity: "monthly" | "yearly";
  setMode: (mode: PeriodMode) => void;
  setMonthKey: (monthKey: string) => void;
};

const PeriodContext = createContext<PeriodContextValue | null>(null);

function loadStoredScope(monthOptions: MonthOption[]): StoredScope | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredScope;
    if (!parsed?.monthKey || !parsed?.mode) return null;
    if (!monthOptions.some((m) => m.monthKey === parsed.monthKey)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function PeriodProvider({ children }: { children: ReactNode }) {
  useLatestReportVersion();

  const report = getLatestReport<{ viewScope?: ReportViewScope }>();
  const monthOptions = useMemo(() => getMonthOptions([...momSummary]), [report]);
  const monthCount = monthOptions.length;

  const statementGranularity: "monthly" | "yearly" =
    report?.viewScope?.statementGranularity ?? (monthCount <= 1 ? "monthly" : "yearly");
  const allowYearlyView = statementGranularity === "yearly" && monthCount > 1;

  const defaultMonthKey =
    monthOptions[monthOptions.length - 1]?.monthKey ??
    resolveMonthKey(momSummary[momSummary.length - 1] ?? {}, monthCount - 1);

  const defaultMode: PeriodMode = allowYearlyView ? "yearly" : "monthly";

  const [mode, setModeState] = useState<PeriodMode>(defaultMode);
  const [monthKey, setMonthKeyState] = useState(defaultMonthKey);

  useEffect(() => {
    setModeState(defaultMode);
    setMonthKeyState(defaultMonthKey);
  }, [defaultMode, defaultMonthKey, statementGranularity, monthCount]);

  useEffect(() => {
    if (!allowYearlyView) return;
    const stored = loadStoredScope(monthOptions);
    if (stored) {
      setModeState(stored.mode);
      setMonthKeyState(stored.monthKey);
    }
  }, [monthOptions, allowYearlyView]);

  useEffect(() => {
    if (!monthOptions.length) return;
    if (!allowYearlyView) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ mode: "monthly", monthKey }),
      );
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, monthKey }));
  }, [mode, monthKey, monthOptions.length, allowYearlyView]);

  const setMode = useCallback(
    (next: PeriodMode) => {
      if (!allowYearlyView && next === "yearly") return;
      setModeState(next);
      if (next === "monthly" && !monthOptions.some((m) => m.monthKey === monthKey)) {
        setMonthKeyState(defaultMonthKey);
      }
    },
    [allowYearlyView, monthKey, monthOptions, defaultMonthKey],
  );

  const setMonthKey = useCallback((key: string) => {
    setMonthKeyState(key);
    setModeState("monthly");
  }, []);

  const monthLabel =
    monthOptions.find((m) => m.monthKey === monthKey)?.monthLabel ?? monthKey;

  const value = useMemo<PeriodContextValue>(
    () => ({
      mode: allowYearlyView ? mode : "monthly",
      monthKey,
      monthLabel,
      monthCount,
      monthOptions,
      allowYearlyView,
      statementGranularity,
      setMode,
      setMonthKey,
    }),
    [
      mode,
      monthKey,
      monthLabel,
      monthCount,
      monthOptions,
      allowYearlyView,
      statementGranularity,
      setMode,
      setMonthKey,
    ],
  );

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function usePeriodScope(): PeriodContextValue {
  const ctx = useContext(PeriodContext);
  if (!ctx) {
    throw new Error("usePeriodScope must be used within PeriodProvider");
  }
  return ctx;
}

export function useOptionalPeriodScope(): PeriodContextValue | null {
  return useContext(PeriodContext);
}

/** Query params for Excel/API when monthly view is active. */
export function useExcelPeriodParams(): Record<string, string> {
  const ctx = useOptionalPeriodScope();
  if (!ctx || ctx.mode !== "monthly") return {};
  return { period: "monthly", monthKey: ctx.monthKey };
}
