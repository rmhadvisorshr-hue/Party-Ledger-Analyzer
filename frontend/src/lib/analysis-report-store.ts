import { useSyncExternalStore } from "react";

const REPORT_KEY = "rmh-bsa.latest-report";
const ANALYSIS_ID_KEY = "rmh-bsa.latest-analysis-id";

type Listener = () => void;

let latestAnalysisId: string | null = null;
let latestReport: unknown | null = null;
let version = 0;
const listeners = new Set<Listener>();

function readStoredAnalysisId(): string | null {
  try {
    return window.localStorage.getItem(ANALYSIS_ID_KEY);
  } catch {
    return null;
  }
}

function writeStoredAnalysisId(id: string) {
  try {
    window.localStorage.setItem(ANALYSIS_ID_KEY, id);
  } catch {
    // The in-memory id is enough for the current session.
  }
}

function removeStoredReport() {
  try {
    window.localStorage.removeItem(REPORT_KEY);
  } catch {
    // Ignore storage failures; reports are fetched by analysis id.
  }
}

function hydrateFromStorage() {
  if (typeof window === "undefined") return;

  if (latestAnalysisId === null) {
    latestAnalysisId = readStoredAnalysisId();
  }

  removeStoredReport();
}

function notify() {
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeLatestReport(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLatestReportVersion() {
  return useSyncExternalStore(
    subscribeLatestReport,
    () => version,
    () => version,
  );
}

export function saveLatestReport(id: string, report: unknown) {
  if (typeof window === "undefined") return;

  latestAnalysisId = id;
  latestReport = report;
  removeStoredReport();
  writeStoredAnalysisId(id);
  notify();
}

export function getLatestAnalysisId(): string | null {
  hydrateFromStorage();
  if (typeof window === "undefined") return latestAnalysisId;
  return latestAnalysisId ?? readStoredAnalysisId();
}

export function getLatestReport<T = unknown>(): T | null {
  hydrateFromStorage();
  if (typeof window === "undefined") return null;

  return (latestReport ?? null) as T | null;
}
