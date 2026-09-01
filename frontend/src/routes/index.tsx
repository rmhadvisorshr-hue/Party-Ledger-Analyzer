import { createFileRoute, Link } from "@tanstack/react-router";
import { Brand, BackToDashboard } from "@/components/site-chrome";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Party Ledger Analyzer - RMH Advisors" }] }),
  component: LandingPage,
});

const features = [
  {
    title: "Party-wise consolidation",
    description: "Resolve counterparties across UPI, IMPS, NEFT, RTGS, cheques and cash, and merge them under one party.",
    icon: (
      <path
        d="M4 13h3l2-7 4 14 2-7h5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "One-page ledger summary",
    description: "Generate a clean, one-page party ledger for audit review, client discussion and internal working papers.",
    icon: (
      <>
        <path d="M7 3h7l4 4v14H7z" strokeLinejoin="round" />
        <path d="M14 3v5h5M10 13h6M10 17h4" strokeLinecap="round" />
      </>
    ),
  },
  {
    title: "Multiple PDFs",
    description: "Upload one or many protected Indian bank statements and process them into one structured report.",
    icon: (
      <>
        <path d="M8 7V5a2 2 0 0 1 2-2h7l3 3v10a2 2 0 0 1-2 2h-2" />
        <path d="M4 9h8l3 3v7a2 2 0 0 1-2 2H4z" strokeLinejoin="round" />
      </>
    ),
  },
];

function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <section className="relative grid-bg">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--primary)_18%,transparent),transparent_32%),radial-gradient(circle_at_bottom_right,color-mix(in_oklab,var(--accent)_14%,transparent),transparent_36%)]" />
        <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8">
          <header className="flex items-center justify-between">
            <Brand />
            <div className="flex items-center gap-4">
              <BackToDashboard />
              <Link
                to="/upload"
                className="rounded-full border border-border bg-card/80 px-4 py-2 text-sm font-medium text-foreground shadow-sm backdrop-blur transition hover:border-primary/40 hover:text-primary"
              >
                Start analysis
              </Link>
            </div>
          </header>

          <div className="grid flex-1 items-center gap-12 py-16 lg:grid-cols-[1.08fr_0.92fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                One-page, party-wise ledger summary
              </div>
              <h1 className="mt-7 max-w-3xl font-display text-5xl font-bold leading-[0.95] tracking-tight text-balance md:text-7xl">
                Turn bank statements into a party-wise ledger, instantly.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
                Upload Indian bank statement PDFs and get a one-page, party-wise ledger summary of every
                counterparty, consolidated across payment modes, in minutes.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to="/upload"
                  className="glow-primary inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                >
                  Upload statements <span className="ml-2" aria-hidden>{"->"}</span>
                </Link>
                <a
                  href="#features"
                  className="inline-flex items-center justify-center rounded-full border border-border bg-card/70 px-6 py-3 text-sm font-semibold text-foreground backdrop-blur transition hover:border-primary/40 hover:text-primary"
                >
                  See what it checks
                </a>
              </div>
            </div>

            <div className="rounded-[2rem] border border-border bg-card/85 p-4 shadow-2xl backdrop-blur">
              <div className="rounded-[1.5rem] border border-border bg-background p-5">
                <div className="flex items-center justify-between border-b border-border pb-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Live report preview</div>
                    <div className="mt-1 font-display text-2xl font-bold">Party ledger summary</div>
                  </div>
                  <div className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">Ready</div>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-3">
                  <Metric label="Parties" value="86" />
                  <Metric label="Transactions" value="460" />
                  <Metric label="Payment modes" value="06" />
                  <Metric label="Unrecognized" value="03" />
                </div>

                <div className="mt-6 rounded-2xl bg-secondary/60 p-4">
                  <div className="flex items-end gap-2">
                    {[36, 58, 46, 72, 55, 82, 68, 91].map((height, index) => (
                      <div
                        key={index}
                        className="flex-1 rounded-t-md bg-primary/80"
                        style={{ height: `${height}px` }}
                      />
                    ))}
                  </div>
                  <div className="mt-4 text-sm font-medium">Top parties by transaction volume</div>
                  <div className="text-xs text-muted-foreground">Auto-generated from uploaded PDFs</div>
                </div>
              </div>
            </div>
          </div>

          <div id="features" className="grid gap-4 pb-8 md:grid-cols-3">
            {features.map((feature) => (
              <div key={feature.title} className="rounded-2xl border border-border bg-card/80 p-5 shadow-sm backdrop-blur">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                    {feature.icon}
                  </svg>
                </div>
                <h2 className="font-display text-lg font-semibold">{feature.title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-2xl font-semibold">{value}</div>
    </div>
  );
}
