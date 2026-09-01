import { useEffect, useState } from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { X, Plus, Pencil, Trash2, Check, MoveRight, RotateCcw } from "lucide-react";
import {
  Sheet,
  SheetPortal,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  sheetVariants,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { formatINR } from "@/data/reportData";
import {
  createParty,
  deleteParty,
  listParties,
  renameParty,
  restoreTransaction,
  type OnDeleteStrategy,
  type PartySummary,
} from "@/lib/api";
import { moveTransactionsToParty, type MoveTarget } from "@/lib/partyMoveHelpers";
import type { SummaryTxn } from "@/lib/transactionSummary";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  analysisId: string | null;
  reportVersion: number;
  onReportUpdated: (id: string, report: unknown) => void;
  selectedTransactionIds: string[];
  onClearSelection: () => void;
  excludedTransactions: SummaryTxn[];
};

const DELETE_OPTIONS: Array<{ value: OnDeleteStrategy; label: string; description: string }> = [
  {
    value: "reassign_unassigned",
    label: "Move to Unassigned",
    description: 'Transactions move to a reserved "Unassigned" party.',
  },
  {
    value: "reassign_original",
    label: "Reset to original party",
    description: "Transactions revert to their auto-detected counterparty.",
  },
  {
    value: "delete_transactions",
    label: "Remove from ledger",
    description: "Transactions are hidden from every party (the underlying bank record is kept).",
  },
];

/** Non-modal variant of the shared Sheet primitive: same slide-in-from-right chrome, but
 * skips SheetContent's built-in full-screen overlay and Radix's focus trap (modal={false})
 * so the transaction summary table underneath stays visible and interactive while this is
 * open -- the "stays open while I work" requirement a blocking dialog can't satisfy. */
function NonModalPanel({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetPortal>
        <SheetPrimitive.Content
          className={cn(
            sheetVariants({ side: "right" }),
            "flex flex-col overflow-hidden border-l shadow-2xl",
          )}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background cursor-pointer transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
          {children}
        </SheetPrimitive.Content>
      </SheetPortal>
    </Sheet>
  );
}

export function PartyManagerPanel({
  open,
  onOpenChange,
  analysisId,
  reportVersion,
  onReportUpdated,
  selectedTransactionIds,
  onClearSelection,
  excludedTransactions,
}: Props) {
  const [parties, setParties] = useState<PartySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newPartyName, setNewPartyName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deletingParty, setDeletingParty] = useState<PartySummary | null>(null);
  const [deleteStrategy, setDeleteStrategy] = useState<OnDeleteStrategy>("reassign_unassigned");
  const [assignTarget, setAssignTarget] = useState("");

  useEffect(() => {
    if (!open || !analysisId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listParties(analysisId)
      .then((res) => {
        if (!cancelled) setParties(res.parties);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load parties.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, analysisId, reportVersion]);

  const applyResult = (result: { id: string; report?: unknown }) => {
    if (result.report) onReportUpdated(result.id, result.report);
  };

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = () => {
    if (!analysisId || !newPartyName.trim()) return;
    void withBusy(async () => {
      const result = await createParty(analysisId, newPartyName.trim());
      applyResult(result);
      setNewPartyName("");
      const res = await listParties(analysisId);
      setParties(res.parties);
    });
  };

  const handleRenameSave = (partyId: string) => {
    if (!analysisId || !renameDraft.trim()) return;
    void withBusy(async () => {
      const result = await renameParty(analysisId, partyId, renameDraft.trim());
      applyResult(result);
      setRenamingId(null);
      const res = await listParties(analysisId);
      setParties(res.parties);
    });
  };

  const handleDeleteConfirm = () => {
    if (!analysisId || !deletingParty) return;
    void withBusy(async () => {
      const result = await deleteParty(analysisId, deletingParty.id, deleteStrategy);
      applyResult(result);
      setDeletingParty(null);
      const res = await listParties(analysisId);
      setParties(res.parties);
    });
  };

  const handleRestore = (transactionId: string) => {
    if (!analysisId) return;
    void withBusy(async () => {
      const result = await restoreTransaction(analysisId, transactionId);
      applyResult(result);
    });
  };

  const handleAssignSelected = () => {
    if (!analysisId || selectedTransactionIds.length === 0 || !assignTarget) return;
    void withBusy(async () => {
      // Same "create the party if needed, then bulk-reassign" helper the in-table bulk bar
      // uses -- one implementation shared across both entry points.
      const target: MoveTarget =
        assignTarget === "__new__"
          ? { id: null, name: newPartyName.trim() || "New Party" }
          : { id: assignTarget, name: parties.find((p) => p.id === assignTarget)?.name ?? "" };
      const result = await moveTransactionsToParty({
        analysisId,
        parties,
        target,
        transactionIds: selectedTransactionIds,
      });
      applyResult(result);
      onClearSelection();
      setNewPartyName("");
      const res = await listParties(analysisId);
      setParties(res.parties);
    });
  };

  return (
    <NonModalPanel open={open} onOpenChange={onOpenChange}>
      <SheetHeader>
        <SheetTitle>Manage Parties</SheetTitle>
        <SheetDescription>
          Create, rename, or delete parties, and move transactions between them. Changes appear in
          the summary table immediately.
        </SheetDescription>
      </SheetHeader>

      {error && (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {selectedTransactionIds.length > 0 && (
        <div className="mt-4 rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
          <div className="text-xs font-semibold text-foreground">
            {selectedTransactionIds.length} transaction
            {selectedTransactionIds.length === 1 ? "" : "s"} selected
          </div>
          <div className="flex gap-2">
            <select
              value={assignTarget}
              onChange={(e) => setAssignTarget(e.target.value)}
              className="flex h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs shadow-sm"
            >
              <option value="">Move to...</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="__new__">
                + New party ({newPartyName.trim() || "type name below"})
              </option>
            </select>
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={!assignTarget || busy}
              onClick={handleAssignSelected}
            >
              <MoveRight className="h-3 w-3 mr-1" /> Move
            </Button>
          </div>
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={onClearSelection}
          >
            Clear selection
          </button>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <Input
          value={newPartyName}
          onChange={(e) => setNewPartyName(e.target.value)}
          placeholder="New party name..."
          className="h-8 text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
          }}
        />
        <Button
          size="sm"
          className="h-8 text-xs"
          disabled={!newPartyName.trim() || busy}
          onClick={handleCreate}
        >
          <Plus className="h-3 w-3 mr-1" /> Create
        </Button>
      </div>

      <div className="mt-4 flex-1 overflow-y-auto space-y-2 pr-1">
        {loading && <div className="text-xs text-muted-foreground">Loading parties...</div>}
        {!loading && parties.length === 0 && (
          <div className="text-xs text-muted-foreground">No manually managed parties yet.</div>
        )}
        {parties.map((party) => (
          <div key={party.id} className="rounded-md border border-border p-2.5 space-y-2">
            {renamingId === party.id ? (
              <div className="flex gap-2">
                <Input
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  className="h-7 text-xs"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameSave(party.id);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => handleRenameSave(party.id)}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-foreground">{party.name}</div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="p-1 rounded hover:bg-muted cursor-pointer text-muted-foreground hover:text-foreground"
                    title="Rename"
                    onClick={() => {
                      setRenamingId(party.id);
                      setRenameDraft(party.name);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="p-1 rounded hover:bg-destructive/10 cursor-pointer text-muted-foreground hover:text-destructive"
                    title="Delete"
                    onClick={() => {
                      setDeletingParty(party);
                      setDeleteStrategy("reassign_unassigned");
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 text-[10px] text-muted-foreground font-mono">
              <span>
                {party.txnCount} txn{party.txnCount === 1 ? "" : "s"}
              </span>
              <span>Dr {formatINR(party.debit)}</span>
              <span>Cr {formatINR(party.credit)}</span>
            </div>

            {deletingParty?.id === party.id && (
              <div className="rounded-md bg-muted/50 p-2.5 space-y-2">
                {party.txnCount > 0 ? (
                  <>
                    <div className="text-[11px] font-medium text-foreground">
                      This party has {party.txnCount} transaction{party.txnCount === 1 ? "" : "s"}.
                      What should happen to them?
                    </div>
                    <RadioGroup
                      value={deleteStrategy}
                      onValueChange={(v) => setDeleteStrategy(v as OnDeleteStrategy)}
                    >
                      {DELETE_OPTIONS.map((opt) => (
                        <label key={opt.value} className="flex items-start gap-2 cursor-pointer">
                          <RadioGroupItem value={opt.value} className="mt-0.5 h-3.5 w-3.5" />
                          <span>
                            <span className="block text-[11px] font-medium text-foreground">
                              {opt.label}
                            </span>
                            <span className="block text-[10px] text-muted-foreground">
                              {opt.description}
                            </span>
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                  </>
                ) : (
                  <div className="text-[11px] text-muted-foreground">
                    This party has no transactions.
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px]"
                    onClick={() => setDeletingParty(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 text-[11px]"
                    disabled={busy}
                    onClick={handleDeleteConfirm}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {excludedTransactions.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            Removed from ledger ({excludedTransactions.length})
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
            {excludedTransactions.map((txn) => (
              <div
                key={txn.id}
                className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-[11px]"
              >
                <div className="min-w-0">
                  <div className="truncate text-foreground font-medium">
                    {txn.customParty || txn.party || "Unrecognized"}
                  </div>
                  <div className="truncate text-muted-foreground text-[10px]">
                    {txn.dateText} - {formatINR(txn.debit || txn.credit || 0)}
                  </div>
                </div>
                <button
                  type="button"
                  className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 hover:bg-primary/20 text-primary text-[10px] font-medium cursor-pointer ml-2"
                  disabled={busy}
                  onClick={() => txn.id && handleRestore(txn.id)}
                >
                  <RotateCcw className="h-2.5 w-2.5" /> Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </NonModalPanel>
  );
}
