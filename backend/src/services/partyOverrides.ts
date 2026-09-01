import type { AnalysisReport, NormalizedTransaction } from "../analysis/types";
import {
  getStore,
  persistStore,
  newId,
  type PartyRecord,
  type AssignmentRecord,
} from "./partyOverrideStore";

export const UNASSIGNED_PARTY_NAME = "Unassigned";

export type OnDeleteStrategy = "reassign_unassigned" | "reassign_original" | "delete_transactions";

function normalizeKey(name: string): string {
  return name.trim().toUpperCase();
}

function logAudit(entry: {
  analysisId: string;
  action: string;
  partyName?: string | null;
  transactionId?: string | null;
  before?: string | null;
  after?: string | null;
  actor?: string | null;
}) {
  const store = getStore(entry.analysisId);
  store.auditLog.push({
    id: newId(),
    analysisId: entry.analysisId,
    action: entry.action,
    partyName: entry.partyName ?? null,
    transactionId: entry.transactionId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    actor: entry.actor ?? null,
    createdAt: new Date().toISOString(),
  });
  persistStore(entry.analysisId);
}

/** Finds a party by case-insensitive name within this analysis, creating it if absent.
 * This is how every reassignment (single or bulk) gets a durable Party to point at,
 * without requiring the caller to have used "Create Party" first. */
function findOrCreateParty(
  analysisId: string,
  name: string,
  opts?: { isManual?: boolean; actor?: string | null },
): PartyRecord {
  const trimmed = name.trim();
  const normalized = normalizeKey(trimmed);
  const store = getStore(analysisId);
  const existing = store.parties.find((p) => p.normalized === normalized);
  if (existing) return existing;

  const now = new Date().toISOString();
  const party: PartyRecord = {
    id: newId(),
    analysisId,
    name: trimmed,
    normalized,
    isManual: opts?.isManual ?? false,
    createdAt: now,
    updatedAt: now,
    createdBy: opts?.actor ?? null,
  };
  store.parties.push(party);
  persistStore(analysisId);
  return party;
}

function getAssignment(
  analysisId: string,
  transactionId: string,
): (AssignmentRecord & { assignedParty: PartyRecord | null }) | null {
  const store = getStore(analysisId);
  const assignment = store.assignments.find((a) => a.transactionId === transactionId);
  if (!assignment) return null;

  const assignedParty = assignment.assignedPartyId
    ? (store.parties.find((p) => p.id === assignment.assignedPartyId) ?? null)
    : null;
  return { ...assignment, assignedParty };
}

function upsertAssignment(
  analysisId: string,
  transactionId: string,
  patch: Partial<Omit<AssignmentRecord, "id" | "analysisId" | "transactionId">> & {
    originalParty: string;
  },
): AssignmentRecord {
  const store = getStore(analysisId);
  const idx = store.assignments.findIndex((a) => a.transactionId === transactionId);
  const now = new Date().toISOString();

  if (idx === -1) {
    const assignment: AssignmentRecord = {
      id: newId(),
      analysisId,
      transactionId,
      originalParty: patch.originalParty,
      assignedPartyId: patch.assignedPartyId ?? null,
      status: patch.status ?? "active",
      updatedAt: now,
      updatedBy: patch.updatedBy ?? null,
    };
    store.assignments.push(assignment);
    return assignment;
  }

  store.assignments[idx] = {
    ...store.assignments[idx],
    ...patch,
    updatedAt: now,
  };
  return store.assignments[idx];
}

/** Reassigns one transaction to `targetPartyName`, creating the Party if needed.
 * `originalPartyLabel` is only used the first time this transaction is ever touched --
 * it snapshots the auto-detected party so a later "reset" or party-delete's
 * reassign-to-original always has a value to fall back to. */
export async function reassignTransaction(params: {
  analysisId: string;
  transactionId: string;
  targetPartyName: string;
  originalPartyLabel: string;
  actor?: string | null;
}) {
  const { analysisId, transactionId, targetPartyName, originalPartyLabel, actor } = params;
  const party = findOrCreateParty(analysisId, targetPartyName, { actor });
  const existing = getAssignment(analysisId, transactionId);

  const assignment = upsertAssignment(analysisId, transactionId, {
    originalParty: originalPartyLabel,
    assignedPartyId: party.id,
    status: "active",
    updatedBy: actor ?? null,
  });
  persistStore(analysisId);

  logAudit({
    analysisId,
    action: "transaction_reassigned",
    partyName: party.name,
    transactionId,
    before: existing?.assignedParty?.name ?? existing?.originalParty ?? originalPartyLabel,
    after: party.name,
    actor,
  });

  return assignment;
}

/** Bulk sibling of reassignTransaction -- same upsert, applied to many transactions at once. */
export async function reassignTransactions(params: {
  analysisId: string;
  targetPartyName: string;
  transactions: Array<{ transactionId: string; originalPartyLabel: string }>;
  actor?: string | null;
}) {
  const { analysisId, targetPartyName, transactions, actor } = params;
  const party = findOrCreateParty(analysisId, targetPartyName, { actor });

  for (const { transactionId, originalPartyLabel } of transactions) {
    const existing = getAssignment(analysisId, transactionId);
    upsertAssignment(analysisId, transactionId, {
      originalParty: originalPartyLabel,
      assignedPartyId: party.id,
      status: "active",
      updatedBy: actor ?? null,
    });
    logAudit({
      analysisId,
      action: "transaction_reassigned",
      partyName: party.name,
      transactionId,
      before: existing?.assignedParty?.name ?? existing?.originalParty ?? originalPartyLabel,
      after: party.name,
      actor,
    });
  }
  persistStore(analysisId);

  return party;
}

/** Clears a manual override, reverting the transaction to its auto-detected party. */
export async function resetTransaction(params: {
  analysisId: string;
  transactionId: string;
  actor?: string | null;
}) {
  const { analysisId, transactionId, actor } = params;
  const existing = getAssignment(analysisId, transactionId);
  if (!existing) return;

  const store = getStore(analysisId);
  store.assignments = store.assignments.filter((a) => a.id !== existing.id);
  persistStore(analysisId);

  logAudit({
    analysisId,
    action: "transaction_reassigned",
    partyName: null,
    transactionId,
    before: existing.assignedParty?.name ?? existing.originalParty,
    after: existing.originalParty,
    actor,
  });
}

/** Soft-deletes a transaction from every party's ledger grouping. The transaction keeps
 * whatever party assignment it already had (or none) -- only `status` changes -- so
 * restoreTransaction() can bring it back exactly where it was. */
export async function excludeTransaction(params: {
  analysisId: string;
  transactionId: string;
  originalPartyLabel: string;
  actor?: string | null;
}) {
  const { analysisId, transactionId, originalPartyLabel, actor } = params;
  upsertAssignment(analysisId, transactionId, {
    originalParty: originalPartyLabel,
    status: "excluded",
    updatedBy: actor ?? null,
  });
  persistStore(analysisId);
  logAudit({ analysisId, action: "transaction_excluded", transactionId, actor });
}

export async function restoreTransaction(params: {
  analysisId: string;
  transactionId: string;
  actor?: string | null;
}) {
  const { analysisId, transactionId, actor } = params;
  const existing = getAssignment(analysisId, transactionId);
  if (!existing || existing.status !== "excluded") return;

  upsertAssignment(analysisId, transactionId, {
    originalParty: existing.originalParty,
    assignedPartyId: existing.assignedPartyId,
    status: "active",
    updatedBy: actor ?? null,
  });
  persistStore(analysisId);
  logAudit({ analysisId, action: "transaction_restored", transactionId, actor });
}

export async function createParty(params: {
  analysisId: string;
  name: string;
  actor?: string | null;
}) {
  const { analysisId, name, actor } = params;
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Party name cannot be empty.");
  const normalized = normalizeKey(trimmed);

  const store = getStore(analysisId);
  const existing = store.parties.find((p) => p.normalized === normalized);
  if (existing) throw new Error(`A party named "${existing.name}" already exists in this analysis.`);

  const now = new Date().toISOString();
  const party: PartyRecord = {
    id: newId(),
    analysisId,
    name: trimmed,
    normalized,
    isManual: true,
    createdAt: now,
    updatedAt: now,
    createdBy: actor ?? null,
  };
  store.parties.push(party);
  persistStore(analysisId);

  logAudit({ analysisId, action: "party_created", partyName: party.name, after: party.name, actor });
  return party;
}

export async function renameParty(params: {
  analysisId: string;
  partyId: string;
  name: string;
  actor?: string | null;
}) {
  const { analysisId, partyId, name, actor } = params;
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Party name cannot be empty.");
  const normalized = normalizeKey(trimmed);

  const store = getStore(analysisId);
  const party = store.parties.find((p) => p.id === partyId);
  if (!party || party.analysisId !== analysisId) throw new Error("Party not found.");

  const clash = store.parties.find((p) => p.normalized === normalized);
  if (clash && clash.id !== partyId)
    throw new Error(`A party named "${clash.name}" already exists in this analysis.`);

  const previousName = party.name;
  party.name = trimmed;
  party.normalized = normalized;
  party.updatedAt = new Date().toISOString();
  persistStore(analysisId);

  logAudit({
    analysisId,
    action: "party_renamed",
    partyName: party.name,
    before: previousName,
    after: party.name,
    actor,
  });
  return party;
}

/** Deletes a party. `onDelete` controls what happens to transactions currently assigned to
 * it: move to the reserved "Unassigned" party, fall back to each transaction's own
 * auto-detected party (same effect as Reset), or soft-delete them from the ledger entirely. */
export async function deleteParty(params: {
  analysisId: string;
  partyId: string;
  onDelete: OnDeleteStrategy;
  actor?: string | null;
}) {
  const { analysisId, partyId, onDelete, actor } = params;
  const store = getStore(analysisId);
  const party = store.parties.find((p) => p.id === partyId);
  if (!party || party.analysisId !== analysisId) throw new Error("Party not found.");

  const affected = store.assignments.filter((a) => a.assignedPartyId === partyId);
  const now = new Date().toISOString();

  if (onDelete === "reassign_unassigned") {
    const unassigned = findOrCreateParty(analysisId, UNASSIGNED_PARTY_NAME, {
      isManual: false,
      actor,
    });
    for (const a of store.assignments) {
      if (a.assignedPartyId === partyId) {
        a.assignedPartyId = unassigned.id;
        a.updatedAt = now;
        a.updatedBy = actor ?? null;
      }
    }
  } else if (onDelete === "reassign_original") {
    // Only drop rows this party's deletion would otherwise leave dangling. Excluded
    // rows keep their history -- the loop below (mirroring the old schema's FK ON
    // DELETE SET NULL) clears their assignedPartyId once the party itself is gone.
    store.assignments = store.assignments.filter(
      (a) => !(a.assignedPartyId === partyId && a.status === "active"),
    );
  } else {
    for (const a of store.assignments) {
      if (a.assignedPartyId === partyId) {
        a.status = "excluded";
        a.updatedAt = now;
        a.updatedBy = actor ?? null;
      }
    }
  }

  // Mirror the old schema's `ON DELETE SET NULL`: any assignment still pointing at
  // this party (e.g. excluded rows left untouched by "reassign_original") loses the
  // reference once the party row itself is removed below.
  for (const a of store.assignments) {
    if (a.assignedPartyId === partyId) a.assignedPartyId = null;
  }

  store.parties = store.parties.filter((p) => p.id !== partyId);
  persistStore(analysisId);

  logAudit({
    analysisId,
    action: "party_deleted",
    partyName: party.name,
    before: party.name,
    after: `${affected.length} transaction(s) -> ${onDelete}`,
    actor,
  });

  return { deletedParty: party, affectedCount: affected.length };
}

export async function getPartyById(analysisId: string, partyId: string) {
  const store = getStore(analysisId);
  const party = store.parties.find((p) => p.id === partyId);
  if (!party || party.analysisId !== analysisId) return null;
  return party;
}

export async function listParties(analysisId: string) {
  const store = getStore(analysisId);
  return [...store.parties].sort((a, b) => a.name.localeCompare(b.name));
}

/** Per-party txn count/debit/credit, computed by joining assignment rows directly
 * against `transactions` (by party id, not by name). Deliberately does not go through
 * buildPartyLedger()'s canonical-label string matching -- that function independently
 * re-normalizes/re-clusters party labels (OCR repair, abbreviation expansion, fuzzy
 * alias merging), so its displayed group name is not guaranteed to equal the exact
 * `Party.name` a user typed, and matching on it would silently under/over-count. */
export async function getPartyTotals(
  analysisId: string,
  transactions: Array<{ id?: string; debit?: number; credit?: number }>,
) {
  const store = getStore(analysisId);
  const partyIdByTxnId = new Map(
    store.assignments
      .filter((a) => a.status === "active" && a.assignedPartyId)
      .map((a) => [a.transactionId, a.assignedPartyId as string]),
  );

  const totals = new Map<string, { txnCount: number; debit: number; credit: number }>();
  for (const txn of transactions) {
    if (!txn.id) continue;
    const partyId = partyIdByTxnId.get(txn.id);
    if (!partyId) continue;
    const bucket = totals.get(partyId) ?? { txnCount: 0, debit: 0, credit: 0 };
    bucket.txnCount += 1;
    bucket.debit += Number(txn.debit || 0);
    bucket.credit += Number(txn.credit || 0);
    totals.set(partyId, bucket);
  }
  return totals;
}

export async function listAuditLog(analysisId: string) {
  const store = getStore(analysisId);
  return [...store.auditLog].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/** Applies every stored override for this analysis onto the in-memory report, without
 * ever mutating the report the caller passed in. `customParty` and `excludedFromLedger`
 * are the only fields touched -- both are additive/optional fields that
 * buildPartyLedger() and extractPartyLedgerFields() already understand, so nothing about
 * the grouping algorithm itself needs to know overrides come from a JSON file now
 * instead of being baked into the transaction directly. */
export async function hydrateReport(
  analysisId: string,
  report: AnalysisReport,
): Promise<AnalysisReport> {
  if (!report.transactions || report.transactions.length === 0) return report;

  const store = getStore(analysisId);
  if (store.assignments.length === 0) return report;

  const partyById = new Map(store.parties.map((p) => [p.id, p]));
  const byTxnId = new Map(store.assignments.map((a) => [a.transactionId, a]));

  const transactions: NormalizedTransaction[] = report.transactions.map((txn) => {
    const assignment = byTxnId.get(txn.id);
    if (!assignment) return txn;

    const updated: NormalizedTransaction = { ...txn };
    const assignedParty = assignment.assignedPartyId ? partyById.get(assignment.assignedPartyId) : null;
    if (assignedParty) {
      updated.customParty = assignedParty.name;
    }
    if (assignment.status === "excluded") {
      updated.excludedFromLedger = true;
    } else {
      delete updated.excludedFromLedger;
    }
    return updated;
  });

  return { ...report, transactions };
}
