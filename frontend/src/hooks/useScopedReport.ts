import { useMemo } from "react";
import {
  momSummary,
  monthlyCF,
  camAnalysis,
  netTransactions,
  salary,
  staffEmoluments,
  bounces,
  emiTracker,
  tradeCredits,
  tradeDebits,
  highestTns,
  internalGroup,
  circular,
  spendAnalysis,
  recurringDebit,
  recurringCredit,
  billPayments,
  transactions,
} from "@/data/reportData";
import { usePeriodScope } from "@/contexts/PeriodContext";
import {
  filterByMonth,
  consolidatedDelta,
  periodCountLabel,
  totalAmountLabel,
  annualEquivalentLabel,
  type MonthKeyed,
} from "@/lib/period";
import { buildDailyFlow } from "@/lib/dailyMetrics";

function scopeRows<T extends MonthKeyed>(rows: T[], mode: string, monthKey: string, monthLabel: string): T[] {
  if (mode === "yearly") return rows;
  return filterByMonth(rows, monthKey, monthLabel);
}

export function useScopedReport() {
  const { mode, monthKey, monthLabel, monthCount, allowYearlyView } = usePeriodScope();
  const isMonthly = mode === "monthly" || !allowYearlyView;

  const scoped = useMemo(() => {
    const scopeMode = mode === "monthly" || !allowYearlyView ? "monthly" : "yearly";
    const mom = scopeRows([...momSummary], scopeMode, monthKey, monthLabel);
    const cf = scopeRows([...monthlyCF], scopeMode, monthKey, monthLabel);
    const cam = scopeRows([...camAnalysis], scopeMode, monthKey, monthLabel);
    const net = scopeRows([...netTransactions], scopeMode, monthKey, monthLabel);
    const sal = scopeRows([...salary], scopeMode, monthKey, monthLabel);
    const staff = scopeRows([...staffEmoluments], scopeMode, monthKey, monthLabel);
    const bounceRows = scopeRows([...bounces], scopeMode, monthKey, monthLabel);
    const emi = scopeRows([...emiTracker], scopeMode, monthKey, monthLabel);

    const tradeCr = scopeMode === "yearly" ? [...tradeCredits] : filterByMonth([...tradeCredits], monthKey, monthLabel);
    const tradeDr = scopeMode === "yearly" ? [...tradeDebits] : filterByMonth([...tradeDebits], monthKey, monthLabel);
    const highest = scopeMode === "yearly" ? [...highestTns] : filterByMonth([...highestTns], monthKey, monthLabel);
    const internal = scopeMode === "yearly" ? [...internalGroup] : filterByMonth([...internalGroup], monthKey, monthLabel);
    const circ = scopeMode === "yearly" ? [...circular] : filterByMonth([...circular], monthKey, monthLabel);

    return {
      momSummary: mom,
      monthlyCF: cf,
      camAnalysis: cam,
      netTransactions: net,
      salary: sal,
      staffEmoluments: staff,
      bounces: bounceRows,
      emiTracker: emi,
      tradeCredits: tradeCr,
      tradeDebits: tradeDr,
      highestTns: highest,
      internalGroup: internal,
      circular: circ,
      spendAnalysis: [...spendAnalysis],
      recurringDebit: [...recurringDebit],
      recurringCredit: [...recurringCredit],
      billPayments: [...billPayments],
    };
  }, [mode, monthKey, monthLabel, allowYearlyView]);

  const labels = useMemo(
    () => ({
      isMonthly,
      periodSubtitle: isMonthly
        ? `Single month · ${monthLabel}`
        : monthCount === 12
          ? "Consolidated 12-month"
          : `Full period · ${periodCountLabel(monthCount, mode)}`,
      consolidatedDelta: consolidatedDelta(monthCount, isMonthly ? "monthly" : "yearly"),
      periodCountLabel: periodCountLabel(monthCount, isMonthly ? "monthly" : "yearly"),
      totalLabel: totalAmountLabel(isMonthly ? "monthly" : "yearly"),
      annualLabel: annualEquivalentLabel(isMonthly ? "monthly" : "yearly"),
      chartTitle: isMonthly
        ? `Daily activity · ${monthLabel}`
        : `Inflow vs outflow · ${monthCount} months`,
      chartSubtitle: isMonthly
        ? "Day-wise credits & debits, with month totals below"
        : "Month-on-month trend across the statement period",
      monthsFraction: (numerator: number) =>
        isMonthly ? `${numerator}/1` : `${numerator}/${monthCount}`,
    }),
    [isMonthly, mode, monthLabel, monthCount],
  );

  const momTotals = useMemo(() => {
    const mom = scoped.momSummary;
    const count = Math.max(mom.length, 1);
    return {
      totalCredits: mom.reduce((s, m) => s + m.totalCredits, 0),
      totalDebits: mom.reduce((s, m) => s + m.totalDebits, 0),
      netFlow: mom.reduce((s, m) => s + m.netFlow, 0),
      cashDeposits: mom.reduce((s, m) => s + m.cashDeposits, 0),
      cashWithdrawals: mom.reduce((s, m) => s + m.cashWithdrawals, 0),
      avgBalance: mom.reduce((s, m) => s + m.abb, 0) / count,
      negMonths: mom.filter((m) => m.netFlow < 0).length,
    };
  }, [scoped.momSummary]);

  const cfTotals = useMemo(
    () =>
      scoped.monthlyCF.reduce(
        (a, m) => ({ op: a.op + m.operating, inv: a.inv + m.investing, fin: a.fin + m.financing }),
        { op: 0, inv: 0, fin: 0 },
      ),
    [scoped.monthlyCF],
  );

  const dailyFlow = useMemo(() => {
    if (!isMonthly) return [];
    return buildDailyFlow([...transactions], monthKey);
  }, [isMonthly, monthKey]);

  return { ...scoped, labels, momTotals, cfTotals, dailyFlow, monthCount, mode, monthKey, monthLabel };
}
