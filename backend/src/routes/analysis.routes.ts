import fs from "node:fs";
import { Router } from "express";
import { convertPdfToStatement } from "../converter/converter";
import { analyzeBankStatements, type ExtractedStatement } from "../analysis";
import { resolvePartiesWithGroq } from "../analysis/groqPartyResolver";
import { listReportMonthKeys, scopeReportByMonth } from "../analysis/scopeReport";
import { createAnalysisRecord, createFailedAnalysisRecord, getAnalysisRecord } from "../storage/analysisStore";
import { statementUpload } from "./convert.routes";
import { excelGenerator } from "../services/excelGenerator";
import { buildExcelExportFilename } from "../utils/exportFilename";
import {
  createParty,
  deleteParty,
  excludeTransaction,
  getPartyById,
  getPartyTotals,
  hydrateReport,
  listAuditLog,
  listParties,
  reassignTransaction,
  reassignTransactions,
  renameParty,
  resetTransaction,
  restoreTransaction,
  type OnDeleteStrategy,
} from "../services/partyOverrides";

export const analysisRouter = Router();

async function applyAiPartyResolution<T extends { transactions?: Array<{ id: string; aiParty?: string; aiCounterPartyLedger?: string; aiPartyConfidence?: number }> }>(
  report: T,
): Promise<T> {
  const transactions = report.transactions || [];
  if (transactions.length === 0) return report;

  const resolved = await resolvePartiesWithGroq(transactions as Parameters<typeof resolvePartiesWithGroq>[0]);
  if (resolved.size === 0) return report;

  transactions.forEach((txn) => {
    const row = resolved.get(txn.id);
    if (!row) return;
    txn.aiParty = row.normalizedParty;
    txn.aiCounterPartyLedger = row.counterPartyLedger || "Others";
    txn.aiPartyConfidence = row.confidence ?? 75;
  });

  return report;
}

function parsePasswordList(body: Record<string, unknown>): string[] {
  const raw = body.passwords;
  if (Array.isArray(raw)) {
    return raw.map((p) => String(p ?? ""));
  }
  if (typeof raw === "string") {
    return [raw];
  }
  return [];
}

function parseScannedList(body: Record<string, unknown>): boolean[] {
  const raw = body.scanned;
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return values.map((value) => String(value) === "true");
}

const OCR_ERROR_CODES = ["OCR_FAILED", "OCR_NO_RESULTS", "OCR_UNSUPPORTED_FILE", "OCR_TOO_MANY_PAGES"];

function getAnalysisErrorStatus(error: { code?: string; message?: string }) {
  if (["PASSWORD_REQUIRED", "INVALID_PASSWORD", "NO_TRANSACTIONS_FOUND", ...OCR_ERROR_CODES].includes(
    error.code || "",
  )) {
    return 400;
  }

  if (/invalid pdf|missing pdf|pdf structure|no transaction/i.test(error.message || "")) {
    return 400;
  }

  return 500;
}

analysisRouter.post("/analysis", statementUpload, async (request, response) => {
  const files = (request.files as Express.Multer.File[] | undefined) || [];
  const passwords = parsePasswordList(request.body as Record<string, unknown>);
  const scannedFlags = parseScannedList(request.body as Record<string, unknown>);
  const legacyPassword = typeof request.body?.password === "string" ? request.body.password : "";

  if (files.length === 0) {
    response.status(400).json({
      code: "PDF_REQUIRED",
      message: "Upload one or more PDF or scanned image files using the form field name 'statement' or 'file'.",
    });
    return;
  }

  try {
    const statements: ExtractedStatement[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const password = passwords[i] ?? legacyPassword ?? "";
      const scanned = scannedFlags[i] ?? false;
      const statement = await convertPdfToStatement(file.path, { password, scanned });
      statements.push({
        fileName: file.originalname,
        accountInfo: statement.accountInfo,
        transactions: statement.transactions,
      });
    }

    const report = await applyAiPartyResolution(analyzeBankStatements({
      applicantName:
        typeof request.body?.applicantName === "string" ? request.body.applicantName : undefined,
      entityType: typeof request.body?.entityType === "string" ? request.body.entityType : undefined,
      pan: typeof request.body?.pan === "string" ? request.body.pan : undefined,
      loanType: typeof request.body?.loanType === "string" ? request.body.loanType : undefined,
      statements,
    }));
    const record = createAnalysisRecord(report);
    if (report && typeof report === "object" && report.applicant) {
      report.applicant.analysisId = record.id;
    }

    response.status(201).json({
      id: record.id,
      status: record.status,
      report,
    });
  } catch (error) {
    const err = error as { code?: string; message?: string };
    const record = createFailedAnalysisRecord(err.message || "Analysis failed.");
    const status = getAnalysisErrorStatus(err);

    response.status(status).json({
      id: record.id,
      status: record.status,
      code: err.code || "ANALYSIS_FAILED",
      message: err.message || "Could not analyze this statement.",
    });
  } finally {
    for (const file of files) {
      fs.rm(file.path, { force: true }, () => {});
    }
  }
});

analysisRouter.post("/analysis/from-statements", async (request, response) => {
  const statements = request.body?.statements as ExtractedStatement[] | undefined;

  if (!Array.isArray(statements) || statements.length === 0) {
    response.status(400).json({
      code: "STATEMENTS_REQUIRED",
      message: "Provide a non-empty statements array.",
    });
    return;
  }

  const report = await applyAiPartyResolution(analyzeBankStatements({
    applicantName: request.body?.applicantName,
    entityType: request.body?.entityType,
    pan: request.body?.pan,
    loanType: request.body?.loanType,
    statements,
  }));
  const record = createAnalysisRecord(report);

  response.status(201).json({
    id: record.id,
    status: record.status,
    report,
  });
});

function resolveReportView(
  report: NonNullable<ReturnType<typeof getAnalysisRecord>>["report"],
  query: Record<string, unknown>,
) {
  if (!report) return report;

  const period = typeof query.period === "string" ? query.period : undefined;
  const monthKey = typeof query.monthKey === "string" ? query.monthKey : undefined;

  if (period === "monthly" && monthKey) {
    return scopeReportByMonth(report, monthKey);
  }

  return report;
}

/** Every transaction-touching route needs the transaction's current auto-detected `party`
 * label so a first-time override can snapshot it as `originalParty` -- this always reads
 * from the raw in-memory report (never the hydrated one), so the snapshot is never itself
 * a previous manual override. */
function findRawTransaction(report: unknown, transactionId: string) {
  const transactions = (report as { transactions?: Array<{ id?: string; party?: string }> }).transactions || [];
  return transactions.find((txn) => txn.id === transactionId);
}

analysisRouter.patch("/analysis/:id/transactions/:transactionId/party", async (request, response) => {
  const { id, transactionId } = request.params;
  const rawParty = request.body?.party;
  const targetPartyName = typeof rawParty === "string" && rawParty.trim() ? rawParty.trim() : null;
  const existing = getAnalysisRecord(id);

  if (!existing || !existing.report) {
    response.status(404).json({
      code: "ANALYSIS_NOT_FOUND",
      message: "No analysis exists for this id.",
    });
    return;
  }

  const rawTxn = findRawTransaction(existing.report, transactionId);
  if (!rawTxn) {
    response.status(404).json({
      code: "TRANSACTION_NOT_FOUND",
      message: "Transaction was not found in this analysis.",
    });
    return;
  }

  if (targetPartyName) {
    await reassignTransaction({
      analysisId: id,
      transactionId,
      targetPartyName,
      originalPartyLabel: rawTxn.party ?? "UNRECOGNIZED",
    });
  } else {
    await resetTransaction({ analysisId: id, transactionId });
  }

  const report = await hydrateReport(id, existing.report as Parameters<typeof hydrateReport>[1]);
  response.json({ id: existing.id, status: existing.status, report });
});

analysisRouter.get("/analysis/:id", async (request, response) => {
  const record = getAnalysisRecord(request.params.id);

  if (!record) {
    response.status(404).json({
      code: "ANALYSIS_NOT_FOUND",
      message: "No analysis exists for this id.",
    });
    return;
  }

  const fullReport = record.report ? await hydrateReport(record.id, record.report as Parameters<typeof hydrateReport>[1]) : record.report;
  const report = resolveReportView(fullReport, request.query as Record<string, unknown>);

  response.json({
    ...record,
    report,
    availableMonths: fullReport ? listReportMonthKeys(fullReport) : [],
  });
});

// Excel download endpoint
analysisRouter.get("/analysis/:id/excel/:module", async (request, response) => {
  try {
    const { id, module } = request.params;
    const record = getAnalysisRecord(id);
    
    if (!record || !record.report) {
      response.status(404).json({
        code: "ANALYSIS_NOT_FOUND",
        message: "No analysis exists for this id.",
      });
      return;
    }
    // Optional filters for specific modules
    const party = typeof request.query.party === "string" ? request.query.party : undefined;
    const hydrated = await hydrateReport(id, record.report as Parameters<typeof hydrateReport>[1]);
    const report = resolveReportView(hydrated, request.query as Record<string, unknown>) ?? hydrated;

    // Generate Excel workbook for the specific module
    const workbook = await excelGenerator.generateModuleExcel(module, report, { party });
    const filename = buildExcelExportFilename(report as Parameters<typeof buildExcelExportFilename>[0], {
      moduleLabel: module,
    });

    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );

    // Write workbook to response
    await workbook.xlsx.write(response);
    response.end();
  } catch (error) {
    console.error('Excel generation error:', error);
    response.status(500).json({
      code: "EXCEL_GENERATION_FAILED",
      message: "Failed to generate Excel file.",
    });
  }
});

function analysisNotFound(response: import("express").Response) {
  response.status(404).json({ code: "ANALYSIS_NOT_FOUND", message: "No analysis exists for this id." });
}

// --- Party manager: create/rename/delete parties, bulk reassign, exclude/restore, audit log ---

analysisRouter.get("/analysis/:id/parties", async (request, response) => {
  const { id } = request.params;
  const record = getAnalysisRecord(id);
  if (!record || !record.report) {
    analysisNotFound(response);
    return;
  }

  const [parties, totals] = await Promise.all([
    listParties(id),
    getPartyTotals(id, (record.report as { transactions?: Array<{ id?: string; debit?: number; credit?: number }> }).transactions ?? []),
  ]);

  response.json({
    parties: parties.map((party) => {
      const row = totals.get(party.id);
      return {
        id: party.id,
        name: party.name,
        isManual: party.isManual,
        createdAt: party.createdAt,
        updatedAt: party.updatedAt,
        txnCount: row?.txnCount ?? 0,
        debit: row?.debit ?? 0,
        credit: row?.credit ?? 0,
        net: (row?.credit ?? 0) - (row?.debit ?? 0),
      };
    }),
  });
});

analysisRouter.post("/analysis/:id/parties", async (request, response) => {
  const { id } = request.params;
  const record = getAnalysisRecord(id);
  if (!record || !record.report) {
    analysisNotFound(response);
    return;
  }

  const name = typeof request.body?.name === "string" ? request.body.name : "";
  let party: Awaited<ReturnType<typeof createParty>>;
  try {
    party = await createParty({ analysisId: id, name });
  } catch (error) {
    response.status(400).json({ code: "PARTY_CREATE_FAILED", message: (error as Error).message });
    return;
  }

  const report = await hydrateReport(id, record.report as Parameters<typeof hydrateReport>[1]);
  response.status(201).json({
    id: record.id,
    status: record.status,
    report,
    party: { id: party.id, name: party.name },
  });
});

analysisRouter.patch("/analysis/:id/parties/:partyId", async (request, response) => {
  const { id, partyId } = request.params;
  const record = getAnalysisRecord(id);
  if (!record || !record.report) {
    analysisNotFound(response);
    return;
  }

  const name = typeof request.body?.name === "string" ? request.body.name : "";
  try {
    await renameParty({ analysisId: id, partyId, name });
  } catch (error) {
    response.status(400).json({ code: "PARTY_RENAME_FAILED", message: (error as Error).message });
    return;
  }

  const report = await hydrateReport(id, record.report as Parameters<typeof hydrateReport>[1]);
  response.json({ id: record.id, status: record.status, report });
});

analysisRouter.post("/analysis/:id/parties/:partyId/transactions", async (request, response) => {
  const { id, partyId } = request.params;
  const record = getAnalysisRecord(id);
  if (!record || !record.report) {
    analysisNotFound(response);
    return;
  }

  const party = await getPartyById(id, partyId);
  if (!party) {
    response.status(404).json({ code: "PARTY_NOT_FOUND", message: "Party not found." });
    return;
  }

  const rawIds = Array.isArray(request.body?.transactionIds) ? (request.body.transactionIds as unknown[]) : [];
  const transactionIds = rawIds.filter((value): value is string => typeof value === "string");
  if (transactionIds.length === 0) {
    response.status(400).json({
      code: "TRANSACTION_IDS_REQUIRED",
      message: "Provide a non-empty transactionIds array.",
    });
    return;
  }

  const transactions = transactionIds
    .map((transactionId) => {
      const rawTxn = findRawTransaction(record.report, transactionId);
      return rawTxn ? { transactionId, originalPartyLabel: rawTxn.party ?? "UNRECOGNIZED" } : null;
    })
    .filter((entry): entry is { transactionId: string; originalPartyLabel: string } => entry !== null);

  await reassignTransactions({ analysisId: id, targetPartyName: party.name, transactions });

  const report = await hydrateReport(id, record.report as Parameters<typeof hydrateReport>[1]);
  response.json({ id: record.id, status: record.status, report });
});

const DELETE_STRATEGIES: OnDeleteStrategy[] = ["reassign_unassigned", "reassign_original", "delete_transactions"];

analysisRouter.delete("/analysis/:id/parties/:partyId", async (request, response) => {
  const { id, partyId } = request.params;
  const record = getAnalysisRecord(id);
  if (!record || !record.report) {
    analysisNotFound(response);
    return;
  }

  const rawStrategy =
    (typeof request.query.onDelete === "string" ? request.query.onDelete : undefined) ??
    (typeof request.body?.onDelete === "string" ? request.body.onDelete : undefined) ??
    "reassign_unassigned";
  const onDelete = (DELETE_STRATEGIES as string[]).includes(rawStrategy)
    ? (rawStrategy as OnDeleteStrategy)
    : "reassign_unassigned";

  try {
    await deleteParty({ analysisId: id, partyId, onDelete });
  } catch (error) {
    response.status(404).json({ code: "PARTY_NOT_FOUND", message: (error as Error).message });
    return;
  }

  const report = await hydrateReport(id, record.report as Parameters<typeof hydrateReport>[1]);
  response.json({ id: record.id, status: record.status, report });
});

analysisRouter.post("/analysis/:id/transactions/:transactionId/exclude", async (request, response) => {
  const { id, transactionId } = request.params;
  const record = getAnalysisRecord(id);
  if (!record || !record.report) {
    analysisNotFound(response);
    return;
  }

  const rawTxn = findRawTransaction(record.report, transactionId);
  if (!rawTxn) {
    response.status(404).json({ code: "TRANSACTION_NOT_FOUND", message: "Transaction was not found in this analysis." });
    return;
  }

  await excludeTransaction({ analysisId: id, transactionId, originalPartyLabel: rawTxn.party ?? "UNRECOGNIZED" });

  const report = await hydrateReport(id, record.report as Parameters<typeof hydrateReport>[1]);
  response.json({ id: record.id, status: record.status, report });
});

analysisRouter.post("/analysis/:id/transactions/:transactionId/restore", async (request, response) => {
  const { id, transactionId } = request.params;
  const record = getAnalysisRecord(id);
  if (!record || !record.report) {
    analysisNotFound(response);
    return;
  }

  await restoreTransaction({ analysisId: id, transactionId });

  const report = await hydrateReport(id, record.report as Parameters<typeof hydrateReport>[1]);
  response.json({ id: record.id, status: record.status, report });
});

analysisRouter.get("/analysis/:id/audit-log", async (request, response) => {
  const { id } = request.params;
  if (!getAnalysisRecord(id)) {
    analysisNotFound(response);
    return;
  }

  const entries = await listAuditLog(id);
  response.json({ entries });
});
