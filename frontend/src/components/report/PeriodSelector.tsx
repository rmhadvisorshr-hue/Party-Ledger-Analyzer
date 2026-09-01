import { usePeriodScope } from "@/contexts/PeriodContext";
import { cn } from "@/lib/utils";

export function PeriodSelector({ className }: { className?: string }) {
  const {
    mode,
    monthKey,
    monthCount,
    monthOptions,
    allowYearlyView,
    statementGranularity,
    setMode,
    setMonthKey,
    monthLabel,
  } = usePeriodScope();

  if (monthCount === 0) return null;

  if (!allowYearlyView) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-md border border-border bg-card/80 px-2.5 py-1.5",
          className,
        )}
      >
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Period</span>
        <span className="text-xs font-medium">{monthLabel}</span>
        <span className="text-[10px] text-muted-foreground font-mono">Monthly statement</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border border-border bg-card/80 px-2 py-1.5",
        className,
      )}
    >
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground px-1">View</span>
      <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
        <button
          type="button"
          onClick={() => setMode("yearly")}
          className={cn(
            "px-2.5 py-1 transition font-medium",
            mode === "yearly" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground",
          )}
        >
          Yearly
        </button>
        <button
          type="button"
          onClick={() => setMode("monthly")}
          className={cn(
            "px-2.5 py-1 transition font-medium border-l border-border",
            mode === "monthly" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground",
          )}
        >
          Monthly
        </button>
      </div>
      {mode === "monthly" && (
        <select
          value={monthKey}
          onChange={(e) => setMonthKey(e.target.value)}
          className="h-7 rounded-md border border-border bg-background px-2 text-xs font-mono min-w-[7rem]"
          aria-label="Select month"
        >
          {monthOptions.map((opt) => (
            <option key={opt.monthKey} value={opt.monthKey}>
              {opt.monthLabel}
            </option>
          ))}
        </select>
      )}
      {mode === "yearly" && (
        <span className="text-[11px] text-muted-foreground font-mono hidden sm:inline">
          {monthCount} mo · {statementGranularity}
        </span>
      )}
    </div>
  );
}
