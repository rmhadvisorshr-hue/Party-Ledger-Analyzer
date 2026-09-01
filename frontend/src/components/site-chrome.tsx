import { Link } from "@tanstack/react-router";

// Plain <a>, not the router's <Link>: this app's TanStack Router basepath is
// set to its own /__tools/one-page-party-analysis/ mount prefix, so a
// <Link to="/dashboard"> would resolve relative to that instead of the staff
// portal's root.
export function BackToDashboard() {
  return (
    <a href="/dashboard" className="text-xs text-muted-foreground hover:text-foreground transition">
      &larr; Back to Dashboard
    </a>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/upload" className="flex items-center gap-2.5 group">
      <div className="relative h-8 w-8">
        <div className="absolute inset-0 rounded-md bg-primary/20 blur-md group-hover:bg-primary/40 transition" />
        <div className="relative h-8 w-8 rounded-md bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-primary-foreground" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 12h3l2-7 4 14 2-7h3M19 12l2 2-2 2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>
      {!compact && (
        <div className="leading-tight">
          <div className="font-display font-bold text-base tracking-tight">RMH<span className="text-primary">.</span>PLA</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-[0.18em] -mt-0.5">PARTY LEDGER ANALYZER</div>
        </div>
      )}
    </Link>
  );
}
