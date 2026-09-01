import { cn } from "@/lib/utils";

export function Stat({
  label,
  value,
  delta,
  accent,
  mono = true,
  className,
}: {
  label: string;
  value: React.ReactNode;
  delta?: string;
  accent?: "positive" | "negative" | "neutral";
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("stat-card rounded-lg border border-border bg-card p-4", className)}>
      <div className="stat-label text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className={cn("stat-value mt-1.5 text-2xl font-semibold", mono && "num")}>{value}</div>
      {delta && (
        <div className={cn("stat-delta text-xs mt-1 num",
          accent === "positive" && "text-[color:var(--positive)]",
          accent === "negative" && "text-[color:var(--negative)]",
          accent === "neutral" && "text-muted-foreground"
        )}>{delta}</div>
      )}
    </div>
  );
}

export function Panel({
  title, subtitle, action, children, className,
}: { title?: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("panel rounded-lg border border-border bg-card overflow-hidden", className)}>
      {(title || action) && (
        <header className="panel-header flex items-start justify-between px-5 py-4 border-b border-border">
          <div className="panel-heading">
            {title && (
              <h3 className="panel-title font-display text-base font-semibold tracking-tight">{title}</h3>
            )}
            {subtitle && (
              <p className="panel-subtitle text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
          {action && <div className="panel-action">{action}</div>}
        </header>
      )}
      <div className="panel-body p-5">{children}</div>
    </section>
  );
}

export function SeverityBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    critical: "bg-[color:var(--risk-critical)]/15 text-[color:var(--risk-critical)] border-[color:var(--risk-critical)]/30",
    high:     "bg-[color:var(--risk-high)]/15 text-[color:var(--risk-high)] border-[color:var(--risk-high)]/30",
    medium:   "bg-[color:var(--risk-medium)]/15 text-[color:var(--risk-medium)] border-[color:var(--risk-medium)]/30",
    low:      "bg-[color:var(--risk-low)]/15 text-[color:var(--risk-low)] border-[color:var(--risk-low)]/30",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider", map[level] ?? map.medium)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {level}
    </span>
  );
}

export function DataTable<T extends Record<string, any>>({
  columns, rows, dense = false,
}: { columns: { key: keyof T & string; label: string; align?: "left" | "right" | "center"; render?: (row: T) => React.ReactNode; mono?: boolean }[]; rows: T[]; dense?: boolean }) {
  return (
    <div className="data-table overflow-x-auto rounded-md border border-border">
      <table className="data-table-table w-full text-sm">
        <thead>
          <tr className="data-table-head bg-muted/40 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {columns.map(c => (
              <th key={c.key} className={cn("data-table-cell px-3 py-2.5 font-medium text-left",
                c.align === "right" && "text-right", c.align === "center" && "text-center")}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="data-table-row border-t border-border hover:bg-muted/30 transition">
              {columns.map(c => (
                <td key={c.key} className={cn("data-table-cell", dense ? "px-3 py-2" : "px-3 py-3",
                  c.align === "right" && "text-right", c.align === "center" && "text-center",
                  c.mono && "num text-[13px]")}>
                  {c.render ? c.render(row) : (row[c.key] as React.ReactNode)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
