export function SectionHead({
  code,
  title,
  subtitle,
  action,
}: {
  code: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-primary">
          <span>{code}</span><span className="h-px w-6 bg-primary/40" /><span className="text-muted-foreground">RMH.PLA</span>
        </div>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
