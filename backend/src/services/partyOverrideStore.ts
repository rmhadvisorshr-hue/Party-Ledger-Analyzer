import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// Replaces the old Prisma/SQLite-backed Party, TransactionAssignment and
// PartyAuditLog tables with one JSON file per analysis. Every access already
// scoped every query by `analysisId` (nothing ever spanned multiple
// analyses), so "one file per analysis, loaded whole" is a lossless fit --
// there is no cross-analysis query to lose.

export type PartyRecord = {
  id: string;
  analysisId: string;
  name: string;
  normalized: string;
  isManual: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
};

export type AssignmentStatus = "active" | "excluded";

export type AssignmentRecord = {
  id: string;
  analysisId: string;
  transactionId: string;
  originalParty: string;
  assignedPartyId: string | null;
  status: AssignmentStatus;
  updatedAt: string;
  updatedBy: string | null;
};

export type AuditLogRecord = {
  id: string;
  analysisId: string;
  action: string;
  partyName: string | null;
  transactionId: string | null;
  before: string | null;
  after: string | null;
  actor: string | null;
  createdAt: string;
};

export type Store = {
  parties: PartyRecord[];
  assignments: AssignmentRecord[];
  auditLog: AuditLogRecord[];
};

function emptyStore(): Store {
  return { parties: [], assignments: [], auditLog: [] };
}

// unified-preview.mjs (a plain script, never bundled by Vite) sets this to an
// absolute, always-correct path before importing the built server module. The
// __dirname fallback below only applies to standalone local dev, where this
// file still runs unbundled from source -- relying on __dirname alone breaks
// once Vite bundles this file into a flat dist/server/assets/*.js chunk,
// where __dirname no longer matches this file's original nested source path.
function resolveDataDir(): string {
  const fromEnv = process.env.PARTY_ANALYSIS_DATA_DIR;
  if (fromEnv) return fromEnv;

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // server/src/services -> server/data
  return path.resolve(__dirname, "..", "..", "data");
}

const STORE_DIR = path.join(resolveDataDir(), "party-overrides");
fs.mkdirSync(STORE_DIR, { recursive: true });

function filePathFor(analysisId: string): string {
  const safe = analysisId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(STORE_DIR, `${safe}.json`);
}

const cache = new Map<string, Store>();

function load(analysisId: string): Store {
  const cached = cache.get(analysisId);
  if (cached) return cached;

  const filePath = filePathFor(analysisId);
  let store: Store;
  if (fs.existsSync(filePath)) {
    try {
      store = JSON.parse(fs.readFileSync(filePath, "utf8")) as Store;
    } catch {
      store = emptyStore();
    }
  } else {
    store = emptyStore();
  }

  cache.set(analysisId, store);
  return store;
}

/** Returns the mutable in-memory store for this analysis, loading it from disk
 * on first access. Callers mutate the returned arrays directly, then call
 * persistStore() to flush -- everything runs synchronously within one request's
 * event-loop turn, so there's no read-modify-write race between requests. */
export function getStore(analysisId: string): Store {
  return load(analysisId);
}

export function persistStore(analysisId: string): void {
  const store = cache.get(analysisId);
  if (!store) return;
  fs.writeFileSync(filePathFor(analysisId), JSON.stringify(store, null, 2), "utf8");
}

export function newId(): string {
  return crypto.randomUUID();
}
