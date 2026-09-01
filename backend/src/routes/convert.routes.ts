import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { convertPdfToExcelBuffer } from "../converter/converter";
import { buildStatementExcelFilename } from "../utils/exportFilename";

const uploadDir = path.join(process.cwd(), "server", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const SCANNED_IMAGE_MIMETYPES = new Set(["image/jpeg", "image/png", "image/tiff"]);
const SCANNED_IMAGE_EXTENSION = /\.(jpe?g|png|tiff?)$/i;

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => callback(null, uploadDir),
  filename: (_request, file, callback) => {
    // The converter/OCR pipeline detects PDF vs. image by file extension, so the temp
    // filename must keep it -- multer's plain `dest` option drops it entirely.
    const ext = path.extname(file.originalname).toLowerCase();
    callback(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    if (
      file.mimetype === "application/pdf" ||
      /\.pdf$/i.test(file.originalname) ||
      SCANNED_IMAGE_MIMETYPES.has(file.mimetype) ||
      SCANNED_IMAGE_EXTENSION.test(file.originalname)
    ) {
      callback(null, true);
      return;
    }

    callback(new Error("Only PDF or scanned image (JPG, PNG, TIFF) files are supported."));
  },
});

export const convertRouter = Router();
export const statementUpload = upload.any();

convertRouter.post("/convert", statementUpload, async (request, response) => {
  const file = (request.files as Express.Multer.File[] | undefined)?.[0];
  const password = request.body?.password || "";

  if (!file) {
    response.status(400).json({
      code: "PDF_REQUIRED",
      message: "Upload a PDF file using the form field name 'statement' or 'file'.",
    });
    return;
  }

  try {
    const result = await convertPdfToExcelBuffer(file.path, { password });
    const outputName = buildStatementExcelFilename(
      { accountInfo: result.statement.accountInfo, fileName: file.originalname },
    );

    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", `attachment; filename="${outputName.replace(/"/g, "")}"`);
    response.setHeader("X-Transaction-Count", String(result.statement.transactions.length));
    response.send(Buffer.from(result.buffer));
  } catch (error) {
    const err = error as { code?: string; message?: string };
    const status = ["PASSWORD_REQUIRED", "INVALID_PASSWORD", "NO_TRANSACTIONS_FOUND"].includes(err.code || "") ? 400 : 500;

    response.status(status).json({
      code: err.code || "CONVERSION_FAILED",
      message: err.message || "Could not convert this statement.",
    });
  } finally {
    fs.rm(file.path, { force: true }, () => {});
  }
});
