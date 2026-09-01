export type PeriodMode = "yearly" | "monthly";

export type MonthOption = {
  monthKey: string;
  monthLabel: string;
};

export type MonthKeyed = {
  month?: string;
  monthKey?: string;
  date?: string;
};

const MONTH_ABBR: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

/** Resolve YYYY-MM from labels like Apr-24 or backend monthKey. */
export function resolveMonthKey(row: MonthKeyed, index = 0): string {
  if (row.monthKey) return row.monthKey;
  if (row.month) {
    const fromLabel = monthLabelToKey(row.month);
    if (fromLabel) return fromLabel;
  }
  return `month-${index}`;
}

export function monthLabelToKey(label: string): string | null {
  const short = label.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (short) {
    const abbr = short[1].slice(0, 1).toUpperCase() + short[1].slice(1, 3).toLowerCase();
    const mm = MONTH_ABBR[abbr];
    if (!mm) return null;
    const yy = Number(short[2]);
    const year = yy >= 50 ? 1900 + yy : 2000 + yy;
    return `${year}-${mm}`;
  }

  const iso = label.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;

  return null;
}

export function dateToMonthKey(date: string): string | null {
  const iso = date.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;

  const dmy = date.match(/(\d{1,2})[/-](\w{3})[/-](\d{2,4})/i);
  if (dmy) {
    const abbr = dmy[2].slice(0, 1).toUpperCase() + dmy[2].slice(1, 3).toLowerCase();
    const mm = MONTH_ABBR[abbr];
    if (!mm) return null;
    let year = Number(dmy[3]);
    if (year < 100) year = year >= 50 ? 1900 + year : 2000 + year;
    return `${year}-${mm}`;
  }

  return null;
}

export function getMonthOptions(rows: MonthKeyed[]): MonthOption[] {
  return rows.map((row, index) => ({
    monthKey: resolveMonthKey(row, index),
    monthLabel: row.month ?? row.monthKey ?? `Month ${index + 1}`,
  }));
}

export function rowMatchesMonth(row: MonthKeyed, monthKey: string, monthLabel?: string): boolean {
  const key = resolveMonthKey(row, 0);
  if (key === monthKey) return true;
  if (monthLabel && row.month === monthLabel) return true;
  if (row.date) {
    const dateKey = dateToMonthKey(row.date);
    if (dateKey === monthKey) return true;
  }
  return false;
}

export function filterByMonth<T extends MonthKeyed>(
  rows: T[],
  monthKey: string,
  monthLabel?: string,
): T[] {
  return rows.filter((row) => rowMatchesMonth(row, monthKey, monthLabel));
}

export function periodCountLabel(count: number, mode: PeriodMode): string {
  if (mode === "monthly") return "1 month";
  return count === 1 ? "1 month" : `${count} months`;
}

export function consolidatedDelta(count: number, mode: PeriodMode): string {
  if (mode === "monthly") return "Selected month";
  return count === 12 ? "12-month consolidated" : `Full period (${count} mo)`;
}

export function totalAmountLabel(mode: PeriodMode): string {
  return mode === "monthly" ? "This month" : "Period total";
}

export function annualEquivalentLabel(mode: PeriodMode): string {
  return mode === "monthly" ? "Monthly amount" : "Annual equivalent";
}
