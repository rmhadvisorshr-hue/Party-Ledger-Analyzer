import { getLatestReport } from "@/lib/analysis-report-store";
import { buildExcelExportFilename } from "@/lib/exportFilename";

/** Same-origin API when unset (integrated dev/production server). */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export type AnalysisResponse = {
  id: string;
  status: "completed" | "failed";
  report?: unknown;
  code?: string;
  message?: string;
};

function getFilenameFromDisposition(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;

  const match = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i);
  if (!match || !match[1]) return fallback;

  const raw = match[1].trim();
  try {
    return decodeURIComponent(raw.replace(/\"/g, ""));
  } catch {
    return raw.replace(/\"/g, "");
  }
}

async function triggerDownload(response: Response, fallbackName: string): Promise<void> {
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  const filename = getFilenameFromDisposition(response.headers.get("Content-Disposition"), fallbackName);

  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

export async function createAnalysis(params: {
  files: Array<{ file: File; password?: string; scanned?: boolean }>;
}): Promise<AnalysisResponse> {
  const formData = new FormData();
  params.files.forEach(({ file, password, scanned }) => {
    formData.append("statement", file);
    formData.append("passwords", password || "");
    formData.append("scanned", scanned ? "true" : "false");
  });

  const response = await fetch(`${API_BASE_URL}/api/analysis`, {
    method: "POST",
    body: formData,
  });
  const payload = (await response.json().catch(() => ({}))) as AnalysisResponse;

  if (!response.ok) {
    throw new Error(payload.message || "Analysis failed.");
  }

  return payload;
}

export async function getAnalysis(id: string): Promise<AnalysisResponse> {
  const response = await fetch(`${API_BASE_URL}/api/analysis/${encodeURIComponent(id)}`);
  const payload = (await response.json().catch(() => ({}))) as AnalysisResponse;

  if (!response.ok) {
    throw new Error(payload.message || "Could not load analysis.");
  }

  return payload;
}

export async function updateTransactionPartyOverride(params: {
  analysisId: string;
  transactionId: string;
  party: string | null;
}): Promise<AnalysisResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/analysis/${encodeURIComponent(params.analysisId)}/transactions/${encodeURIComponent(params.transactionId)}/party`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ party: params.party }),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as AnalysisResponse;

  if (!response.ok) {
    throw new Error(payload.message || "Could not update transaction assignment.");
  }

  return payload;
}

export type PartySummary = {
  id: string;
  name: string;
  isManual: boolean;
  createdAt: string;
  updatedAt: string;
  txnCount: number;
  debit: number;
  credit: number;
  net: number;
};

export type PartyAuditLogEntry = {
  id: string;
  action: string;
  partyName: string | null;
  transactionId: string | null;
  before: string | null;
  after: string | null;
  actor: string | null;
  createdAt: string;
};

export type OnDeleteStrategy = "reassign_unassigned" | "reassign_original" | "delete_transactions";

async function partyApiRequest<T>(
  path: string,
  init: RequestInit,
  fallbackMessage: string,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/analysis/${path}`, {
    ...init,
    headers: init.body ? { "Content-Type": "application/json", ...init.headers } : init.headers,
  });
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string };

  if (!response.ok) {
    throw new Error(payload?.message || fallbackMessage);
  }

  return payload;
}

export async function listParties(analysisId: string): Promise<{ parties: PartySummary[] }> {
  return partyApiRequest(`${encodeURIComponent(analysisId)}/parties`, { method: "GET" }, "Could not load parties.");
}

export async function createParty(
  analysisId: string,
  name: string,
): Promise<AnalysisResponse & { party?: { id: string; name: string } }> {
  return partyApiRequest(
    `${encodeURIComponent(analysisId)}/parties`,
    { method: "POST", body: JSON.stringify({ name }) },
    "Could not create party.",
  );
}

export async function renameParty(analysisId: string, partyId: string, name: string): Promise<AnalysisResponse> {
  return partyApiRequest(
    `${encodeURIComponent(analysisId)}/parties/${encodeURIComponent(partyId)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
    "Could not rename party.",
  );
}

export async function bulkReassignTransactions(
  analysisId: string,
  partyId: string,
  transactionIds: string[],
): Promise<AnalysisResponse> {
  return partyApiRequest(
    `${encodeURIComponent(analysisId)}/parties/${encodeURIComponent(partyId)}/transactions`,
    { method: "POST", body: JSON.stringify({ transactionIds }) },
    "Could not reassign transactions.",
  );
}

export async function deleteParty(
  analysisId: string,
  partyId: string,
  onDelete: OnDeleteStrategy,
): Promise<AnalysisResponse> {
  return partyApiRequest(
    `${encodeURIComponent(analysisId)}/parties/${encodeURIComponent(partyId)}?onDelete=${onDelete}`,
    { method: "DELETE" },
    "Could not delete party.",
  );
}

export async function excludeTransaction(analysisId: string, transactionId: string): Promise<AnalysisResponse> {
  return partyApiRequest(
    `${encodeURIComponent(analysisId)}/transactions/${encodeURIComponent(transactionId)}/exclude`,
    { method: "POST" },
    "Could not remove transaction from ledger.",
  );
}

export async function restoreTransaction(analysisId: string, transactionId: string): Promise<AnalysisResponse> {
  return partyApiRequest(
    `${encodeURIComponent(analysisId)}/transactions/${encodeURIComponent(transactionId)}/restore`,
    { method: "POST" },
    "Could not restore transaction.",
  );
}

export async function listAuditLog(analysisId: string): Promise<{ entries: PartyAuditLogEntry[] }> {
  return partyApiRequest(`${encodeURIComponent(analysisId)}/audit-log`, { method: "GET" }, "Could not load activity log.");
}

/**
 * Download Excel file for a specific module
 */
export async function downloadModuleExcel(
  analysisId: string,
  moduleName: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<void> {
  const query = params
    ? "?" + new URLSearchParams(
        Object.entries(params).reduce<Record<string, string>>((acc, [key, value]) => {
          if (value === undefined || value === null || value === "") return acc;
          acc[key] = String(value);
          return acc;
        }, {}),
      ).toString()
    : "";

  const response = await fetch(
    `${API_BASE_URL}/api/analysis/${encodeURIComponent(analysisId)}/excel/${encodeURIComponent(moduleName)}${query}`
  );

  if (!response.ok) {
    throw new Error('Failed to download Excel file');
  }

  const report = getLatestReport<Parameters<typeof buildExcelExportFilename>[0]>() ?? {};
  await triggerDownload(
    response,
    buildExcelExportFilename(report, { moduleLabel: moduleName }),
  );
}
