type AnalysisRecord = {
  id: string;
  status: "completed" | "failed";
  createdAt: string;
  report?: unknown;
  error?: string;
};

const analyses = new Map<string, AnalysisRecord>();

export function createAnalysisRecord(report: unknown): AnalysisRecord {
  const id = `PLA-${new Date().getUTCFullYear()}-${String(Date.now()).slice(-7)}`;
  const record: AnalysisRecord = {
    id,
    status: "completed",
    createdAt: new Date().toISOString(),
    report,
  };

  analyses.set(id, record);
  return record;
}

export function createFailedAnalysisRecord(error: string): AnalysisRecord {
  const id = `PLA-${new Date().getUTCFullYear()}-${String(Date.now()).slice(-7)}`;
  const record: AnalysisRecord = {
    id,
    status: "failed",
    createdAt: new Date().toISOString(),
    error,
  };

  analyses.set(id, record);
  return record;
}

export function getAnalysisRecord(id: string): AnalysisRecord | undefined {
  return analyses.get(id);
}
