import {
  bulkReassignTransactions,
  createParty,
  type AnalysisResponse,
  type PartySummary,
} from "@/lib/api";

export type MoveTarget = { id: string; name: string } | { id: null; name: string };

/** Shared by every "move selected transactions to a party" entry point (the Manage Parties
 * panel's own selection section, and the in-table bulk bar) so there is exactly one
 * implementation of "create the party if it doesn't exist yet, then bulk-reassign" instead
 * of two copies that could drift. `target.id === null` means the party picker's typed text
 * didn't match an existing party and should be created on the fly. */
export async function moveTransactionsToParty(params: {
  analysisId: string;
  parties: PartySummary[];
  target: MoveTarget;
  transactionIds: string[];
}): Promise<AnalysisResponse> {
  const { analysisId, parties, target, transactionIds } = params;

  let partyId = target.id;
  if (!partyId) {
    const existing = parties.find((p) => p.name.toLowerCase() === target.name.trim().toLowerCase());
    if (existing) {
      partyId = existing.id;
    } else {
      const created = await createParty(analysisId, target.name.trim());
      if (!created.party) {
        throw new Error("Party was created but its id was not returned.");
      }
      partyId = created.party.id;
    }
  }

  return bulkReassignTransactions(analysisId, partyId, transactionIds);
}
