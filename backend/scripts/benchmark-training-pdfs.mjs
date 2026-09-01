/**
 * Benchmark PDF parsing against training data.
 * Usage: node backend/scripts/benchmark-training-pdfs.mjs [folder]
 * Default folder: D:\Data\ai-bankconverter\normal data
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, "..");

const DEFAULT_FOLDER = "D:\\Data\\ai-bankconverter\\normal data";
const folder = process.argv[2] || DEFAULT_FOLDER;

const converterUrl = pathToFileURL(
  path.join(backendRoot, "src/converter/converter.ts"),
).href;

async function collectPdfs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectPdfs(fullPath)));
      continue;
    }
    if (/\.pdf$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function balanceChainMismatches(transactions) {
  let mismatches = 0;

  for (let index = 0; index < transactions.length - 1; index += 1) {
    const row = transactions[index];
    const older = transactions[index + 1];
    if (row.balance === null || older.balance === null) continue;

    const delta = roundMoney(row.balance - older.balance);
    const expectedWithdrawal = delta < 0 ? Math.abs(delta) : 0;
    const expectedDeposit = delta > 0 ? delta : 0;
    const withdrawal = row.withdrawal || 0;
    const deposit = row.deposit || 0;

    if (
      Math.abs(withdrawal - expectedWithdrawal) > 0.02 ||
      Math.abs(deposit - expectedDeposit) > 0.02
    ) {
      mismatches += 1;
    }
  }

  return mismatches;
}

async function main() {
  let folderStat;
  try {
    folderStat = await stat(folder);
  } catch {
    console.error(`Training folder not found: ${folder}`);
    process.exit(1);
  }

  if (!folderStat.isDirectory()) {
    console.error(`Not a directory: ${folder}`);
    process.exit(1);
  }

  const pdfs = await collectPdfs(folder);
  if (pdfs.length === 0) {
    console.log(`No PDF files found in ${folder}`);
    process.exit(0);
  }

  const { convertPdfToStatement } = await import(converterUrl);
  console.log(`Benchmarking ${pdfs.length} PDF(s) from:\n  ${folder}\n`);

  let failures = 0;

  for (const pdfPath of pdfs) {
    const label = path.basename(pdfPath);
    try {
      const statement = await convertPdfToStatement(pdfPath);
      const count = statement.transactions.length;
      const mismatches = balanceChainMismatches(statement.transactions);
      const status = count === 0 ? "NO TXNS" : mismatches > 0 ? "AMOUNT WARN" : "OK";

      console.log(
        `[${status}] ${label}: ${count} transactions` +
          (mismatches > 0 ? ` (${mismatches} balance mismatches)` : "") +
          (statement.totals?.source ? ` · totals=${statement.totals.source}` : ""),
      );

      if (count === 0 || mismatches > 0) failures += 1;
    } catch (error) {
      failures += 1;
      console.log(`[FAIL] ${label}: ${error.message || error}`);
    }
  }

  console.log(`\nDone. ${failures}/${pdfs.length} file(s) need attention.`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
