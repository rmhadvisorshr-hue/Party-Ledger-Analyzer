import { useMemo, useState } from "react";
import { formatINR } from "@/data/reportData";
import {
  buildPartyLedger,
  extractPartyLedgerFields,
  type PartyType,
  type SummaryTxn,
  type TransactionSummaryRow,
} from "@/lib/transactionSummary";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Edit, RotateCcw, Trash2, MoveRight, ChevronsUpDown } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PartyPicker } from "@/components/report/PartyPicker";
import type { PartySummary } from "@/lib/api";
import type { MoveTarget } from "@/lib/partyMoveHelpers";

type Props = {
  transactions: SummaryTxn[];
  onUpdateOverride?: (txnId: string, newParty: string | null) => void;
  onExcludeTransaction?: (txnId: string) => void;
  selectedTransactionIds?: Set<string>;
  onToggleSelect?: (txnId: string) => void;
  /** DB-tracked parties (custom-created/renamed ones) for the Move picker and the Modify
   * dropdown -- merged with the auto-detected group names already visible below. */
  parties?: PartySummary[];
  onBulkMove?: (target: MoveTarget, transactionIds: string[]) => void;
};

function formatAmount(value: number): string {
  return value > 0 ? formatINR(value) : formatINR(0);
}

/** Short label + tone for the party-type badge. Person/merchant (the common, "real
 * counterparty" case) intentionally render no badge to avoid cluttering every row. */
const PARTY_TYPE_BADGE: Partial<Record<PartyType, { label: string; className: string }>> = {
  bank_system: { label: "BANK/SYSTEM", className: "bg-slate-500/10 text-slate-500 border-slate-500/20" },
  charge: { label: "CHARGE/INTEREST", className: "bg-orange-500/10 text-orange-500 border-orange-500/20" },
  self: { label: "SELF/INTERNAL", className: "bg-slate-500/10 text-slate-500 border-slate-500/20" },
};

function PartyTypeBadge({ partyType }: { partyType: PartyType }) {
  const badge = PARTY_TYPE_BADGE[partyType];
  if (!badge) return null;
  return (
    <span
      className={cn(
        "ml-1.5 inline-block rounded border px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide",
        badge.className,
      )}
    >
      {badge.label}
    </span>
  );
}

export function TransactionSummaryTable({
  transactions,
  onUpdateOverride,
  onExcludeTransaction,
  selectedTransactionIds,
  onToggleSelect,
  parties = [],
  onBulkMove,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingTxn, setEditingTxn] = useState<SummaryTxn | null>(null);

  const { summary, byParty: byLabel } = useMemo(() => buildPartyLedger(transactions), [transactions]);

  const autoDetectedNames = useMemo(() => {
    const names = summary.map((r) => r.party).filter((p) => p !== "UNRECOGNIZED");
    return Array.from(new Set(names)).sort();
  }, [summary]);

  // Every party a row can be moved to: DB-tracked custom/renamed parties plus whatever
  // auto-detected group names are currently on screen, deduplicated case-insensitively.
  const existingParties = useMemo(() => {
    const known = new Set(autoDetectedNames.map((n) => n.toLowerCase()));
    const merged = [...autoDetectedNames];
    for (const p of parties) {
      if (!known.has(p.name.toLowerCase())) {
        known.add(p.name.toLowerCase());
        merged.push(p.name);
      }
    }
    return merged.sort();
  }, [autoDetectedNames, parties]);

  const toggle = (party: string) => {
    setExpanded((current) => (current === party ? null : party));
  };

  const selectedCount = selectedTransactionIds?.size ?? 0;

  return (
    <div className="rounded-md border border-border overflow-x-auto">
      {selectedCount > 0 && onBulkMove && (
        <div className="flex items-center justify-between gap-3 border-b border-primary/20 bg-primary/5 px-3 py-2 text-xs">
          <span className="font-medium text-foreground">
            {selectedCount} transaction{selectedCount === 1 ? "" : "s"} selected
          </span>
          <div className="flex items-center gap-2">
            <PartyPicker
              parties={parties}
              extraNames={autoDetectedNames}
              onSelect={(target) => onBulkMove(target, [...(selectedTransactionIds ?? [])])}
              trigger={
                <Button size="sm" className="h-7 text-[11px] gap-1 cursor-pointer">
                  <MoveRight className="h-3 w-3" /> Move selected to...
                </Button>
              }
            />
          </div>
        </div>
      )}
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
            <th className="w-8 px-2 py-2" aria-hidden />
            <th className="px-3 py-2 text-left font-medium">TRANSACTION</th>
            <th className="px-3 py-2 text-right font-medium">NO. OF TRANSACTIONS</th>
            <th className="px-3 py-2 text-right font-medium">DEBIT AMOUNT</th>
            <th className="px-3 py-2 text-right font-medium">CREDIT AMOUNT</th>
            <th className="px-3 py-2 text-right font-medium">NET TRANSACTION</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((row) => (
            <SummaryGroup
              key={row.party}
              row={row}
              open={expanded === row.party}
              onToggle={() => toggle(row.party)}
              details={byLabel.get(row.party) ?? []}
              onEditTransaction={setEditingTxn}
              onUpdateOverride={onUpdateOverride}
              onExcludeTransaction={onExcludeTransaction}
              selectedTransactionIds={selectedTransactionIds}
              onToggleSelect={onToggleSelect}
              parties={parties}
              autoDetectedNames={autoDetectedNames}
            />
          ))}
        </tbody>
      </table>
      {summary.length === 0 && (
        <div className="p-8 text-center text-sm text-muted-foreground">No transactions in this period.</div>
      )}

      {/* Reassignment Modal */}
      <Dialog
        open={!!editingTxn}
        onOpenChange={(open) => {
          if (!open) setEditingTxn(null);
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Modify Transaction Placement</DialogTitle>
            <DialogDescription>
              Reassign this transaction to a different counterparty/client name. Group totals will be recalculated dynamically.
            </DialogDescription>
          </DialogHeader>

          {editingTxn && (
            <ModifyForm
              transaction={editingTxn}
              existingParties={existingParties}
              onSave={(newParty) => {
                onUpdateOverride?.(editingTxn.id || "", newParty);
                setEditingTxn(null);
              }}
              onCancel={() => setEditingTxn(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryGroup({
  row,
  open,
  onToggle,
  details,
  onEditTransaction,
  onUpdateOverride,
  onExcludeTransaction,
  selectedTransactionIds,
  onToggleSelect,
  parties,
  autoDetectedNames,
}: {
  row: TransactionSummaryRow;
  open: boolean;
  onToggle: () => void;
  details: SummaryTxn[];
  onEditTransaction: (txn: SummaryTxn) => void;
  onUpdateOverride?: (txnId: string, newParty: string | null) => void;
  onExcludeTransaction?: (txnId: string) => void;
  selectedTransactionIds?: Set<string>;
  onToggleSelect?: (txnId: string) => void;
  parties: PartySummary[];
  autoDetectedNames: string[];
}) {
  return (
    <>
      <tr
        className={cn(
          "border-b border-border cursor-pointer transition-colors",
          open ? "bg-primary/5" : "hover:bg-muted/40",
        )}
        onClick={onToggle}
      >
        <td className="px-2 py-2.5 text-muted-foreground">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </td>
        <td className="px-3 py-2.5 font-medium text-primary">
          <div className="flex items-center gap-2">
            <span>{row.party}</span>
            <PartyTypeBadge partyType={row.partyType} />
          </div>
          {row.aliases.length > 0 && (
            <div className="mt-0.5 text-[10px] font-normal text-muted-foreground">
              Aliases: {row.aliases.slice(0, 2).join(", ")}
              {row.aliases.length > 2 ? ` +${row.aliases.length - 2}` : ""}
            </div>
          )}
        </td>
        <td className="px-3 py-2.5 text-right font-mono">{row.txnCount}</td>
        <td className="px-3 py-2.5 text-right font-mono">{formatAmount(row.debit)}</td>
        <td className="px-3 py-2.5 text-right font-mono text-[color:var(--positive)]">
          {formatAmount(row.credit)}
        </td>
        <td
          className={cn(
            "px-3 py-2.5 text-right font-mono font-medium",
            row.net >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]",
          )}
        >
          {formatINR(row.net)}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border bg-muted/20">
          <td colSpan={6} className="p-0">
            <div className="px-3 py-3 border-t border-border/60">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Transactions</div>
                  <div className="text-xs font-semibold">
                    {row.party} - {details.length} transaction{details.length === 1 ? "" : "s"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle();
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  Collapse
                </button>
              </div>
              <div className="rounded-md border border-border overflow-hidden bg-background">
                <table className="w-full min-w-[1020px] text-xs">
                  <thead>
                    <tr className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                       <th className="px-2 py-1.5 text-center w-64">Action</th>
                      <th className="px-2 py-1.5 text-left">Party Name</th>
                      <th className="px-2 py-1.5 text-left">Date</th>
                      <th className="px-2 py-1.5 text-left">Type</th>
                      <th className="px-2 py-1.5 text-left">Mode</th>
                      <th className="px-2 py-1.5 text-left">Category</th>
                      <th className="px-2 py-1.5 text-right">Debit</th>
                      <th className="px-2 py-1.5 text-right">Credit</th>
                      <th className="px-2 py-1.5 text-left">Narration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.map((txn, idx) => {
                      const extraction = extractPartyLedgerFields(txn);
                      return (
                        <tr key={`${txn.dateText}-${idx}`} className="border-t border-border/60 hover:bg-muted/10 transition-colors">
                          <td className="px-2 py-1.5 text-center whitespace-nowrap space-x-1.5">
                            {onToggleSelect && (
                              <input
                                type="checkbox"
                                checked={!!txn.id && !!selectedTransactionIds?.has(txn.id)}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  if (txn.id) onToggleSelect(txn.id);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="align-middle mr-1 cursor-pointer"
                                title="Select for bulk move"
                              />
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditTransaction(txn);
                              }}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 hover:bg-primary/20 text-primary text-[10px] font-medium transition-colors cursor-pointer"
                            >
                              <Edit className="h-2.5 w-2.5" />
                              Modify
                            </button>
                            {onUpdateOverride && (
                              <PartyPicker
                                parties={parties}
                                extraNames={autoDetectedNames}
                                onSelect={(target) => {
                                  if (txn.id) onUpdateOverride(txn.id, target.name);
                                }}
                                trigger={
                                  <button
                                    type="button"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted hover:bg-accent text-foreground text-[10px] font-medium transition-colors cursor-pointer"
                                    title="Move to a different party"
                                  >
                                    <ChevronsUpDown className="h-2.5 w-2.5" />
                                    Move
                                  </button>
                                }
                              />
                            )}
                            {onExcludeTransaction && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (txn.id) onExcludeTransaction(txn.id);
                                }}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted hover:bg-destructive/20 text-muted-foreground hover:text-destructive text-[10px] font-medium transition-colors cursor-pointer"
                                title="Remove from ledger (soft delete -- the bank record is kept)"
                              >
                                <Trash2 className="h-2.5 w-2.5" />
                                Delete
                              </button>
                            )}
                            {txn.customParty && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onUpdateOverride?.(txn.id || "", null);
                                }}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-destructive/10 hover:bg-destructive/20 text-destructive text-[10px] font-medium transition-colors cursor-pointer"
                                title="Reset transaction to default placement"
                              >
                                <RotateCcw className="h-2.5 w-2.5" />
                                Reset
                              </button>
                            )}
                          </td>
                          <td className="px-2 py-1.5 font-medium text-foreground">
                            {extraction.normalized_party_name}
                            <PartyTypeBadge partyType={extraction.party_type} />
                            {txn.customParty && (
                              <span className="ml-1 text-[8px] bg-amber-500/20 text-amber-600 px-1 rounded font-semibold uppercase">
                                Manual
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 font-mono whitespace-nowrap">{txn.dateText ?? "-"}</td>
                          <td className="px-2 py-1.5">{txn.direction ?? extraction.debit_credit}</td>
                          <td className="px-2 py-1.5">{extraction.transaction_mode}</td>
                          <td className="px-2 py-1.5">
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[9px] font-medium",
                              txn.customParty 
                                ? "bg-amber-500/10 text-amber-500 border border-amber-500/20" 
                                : "bg-muted text-muted-foreground"
                            )}>
                              {extraction.category}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono">
                            {txn.debit ? formatINR(txn.debit) : "-"}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono">
                            {txn.credit ? formatINR(txn.credit) : "-"}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground min-w-[300px] whitespace-normal break-words" title={txn.narration}>
                            {txn.narration ?? "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ModifyForm({
  transaction,
  existingParties,
  onSave,
  onCancel,
}: {
  transaction: SummaryTxn;
  existingParties: string[];
  onSave: (newParty: string | null) => void;
  onCancel: () => void;
}) {
  const [partyName, setPartyName] = useState(transaction.customParty || transaction.party || "");

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (partyName.trim() === "") {
      onSave(null);
    } else {
      onSave(partyName.trim());
    }
  };

  const amountText = transaction.debit
    ? `${formatINR(transaction.debit)} (Debit)`
    : transaction.credit
      ? `${formatINR(transaction.credit)} (Credit)`
      : "-";

  return (
    <form onSubmit={handleSave} className="space-y-4 pt-2">
      {/* Transaction Summary Panel */}
      <div className="rounded-lg bg-muted/40 border border-border p-3 space-y-1.5 text-xs text-muted-foreground">
        <div>
          <span className="font-semibold text-foreground">Date:</span> {transaction.dateText || "-"}
        </div>
        <div>
          <span className="font-semibold text-foreground">Amount:</span>{" "}
          <span className={transaction.credit ? "text-[color:var(--positive)] font-medium" : "text-[color:var(--negative)] font-medium"}>
            {amountText}
          </span>
        </div>
        <div>
          <span className="font-semibold text-foreground">Narration:</span> {transaction.narration || "-"}
        </div>
        <div>
          <span className="font-semibold text-foreground">Mode:</span> {transaction.mode || "-"}
        </div>
        {transaction.customParty && (
          <div className="text-[10px] text-amber-500 font-semibold bg-amber-500/10 rounded px-1.5 py-0.5 mt-1 inline-block border border-amber-500/20">
            Currently Overridden to: {transaction.customParty}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-foreground">
          Option A: Select from Existing Clients
        </label>
        <select
          value={existingParties.includes(partyName.toUpperCase()) ? partyName.toUpperCase() : ""}
          onChange={(e) => {
            if (e.target.value) {
              setPartyName(e.target.value);
            }
          }}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">-- Choose existing client --</option>
          {existingParties.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-foreground">
          Option B: Or Type Custom Client Name
        </label>
        <Input
          type="text"
          value={partyName}
          onChange={(e) => setPartyName(e.target.value)}
          placeholder="Type new or custom client name..."
          className="bg-background"
        />
      </div>

      <DialogFooter className="flex items-center justify-between gap-2 pt-2 border-t border-border mt-4">
        {transaction.customParty ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => onSave(null)}
            className="text-[11px] h-8 cursor-pointer"
          >
            Reset to Default
          </Button>
        ) : (
          <div />
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="h-8 cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={partyName.trim() === ""}
            className="h-8 cursor-pointer"
          >
            Save Assignment
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
