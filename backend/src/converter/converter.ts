// @ts-nocheck
import path from "node:path";
import { buildWorkbookBuffer, writeWorkbookFile } from "./excelWriter.js";
import { parseStatement } from "./parser.js";
import { extractPdf } from "./pdfExtractor.js";
import { extractScannedFile } from "./tesseractExtractor.js";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff"]);

function isImageFile(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function runExtraction(filePath, options, stage) {
  const start = Date.now();
  const extraction =
    stage === "ocr" ? await extractScannedFile(filePath) : await extractPdf(filePath, options.password);

  return {
    extraction,
    log: {
      level: "info",
      stage,
      message: `${extraction.pageCount || 0} page(s) processed.`,
      pagesProcessed: extraction.pageCount || 0,
      durationMs: Date.now() - start,
    },
  };
}

async function convertPdfToStatement(filePath, options = {}) {
  const logs = [];
  const totalStart = Date.now();

  let stage = options.scanned === true || isImageFile(filePath) ? "ocr" : "pdf";
  let { extraction, log } = await runExtraction(filePath, options, stage);
  logs.push(log);

  let parseStart = Date.now();
  let statement = parseStatement(extraction);

  if (statement.transactions.length === 0 && stage === "pdf") {
    // Scanned/photocopied statements still arrive as ordinary PDFs with no
    // text layer, so there's no reliable way to tell upfront -- fall back to
    // OCR once whenever the native text extraction comes up empty.
    stage = "ocr";
    ({ extraction, log } = await runExtraction(filePath, options, stage));
    logs.push(log);
    parseStart = Date.now();
    statement = parseStatement(extraction);
  }

  statement.logs = [...logs, ...(statement.logs || [])];
  statement.logs.push({
    level: "info",
    stage: "parse",
    message: `${statement.transactions.length} transaction(s) extracted.`,
    transactionsExtracted: statement.transactions.length,
    durationMs: Date.now() - parseStart,
  });
  statement.logs.push({
    level: "info",
    stage: "total",
    message: "Conversion pipeline completed.",
    durationMs: Date.now() - totalStart,
  });

  if (statement.transactions.length === 0) {
    const error = new Error(
      stage === "ocr"
        ? "No transaction rows were detected in this statement, even after OCR."
        : "No transaction rows were detected in this PDF.",
    );
    error.code = "NO_TRANSACTIONS_FOUND";
    throw error;
  }

  return statement;
}

async function convertPdfToExcelBuffer(filePath, options = {}) {
  const statement = await convertPdfToStatement(filePath, options);
  const buffer = await buildWorkbookBuffer(statement);

  return {
    buffer,
    statement,
  };
}

async function convertPdfToExcelFile(filePath, outputPath, options = {}) {
  const statement = await convertPdfToStatement(filePath, options);
  await writeWorkbookFile(statement, outputPath);

  return statement;
}

export { convertPdfToStatement, convertPdfToExcelBuffer, convertPdfToExcelFile };
