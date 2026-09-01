// @ts-nocheck
import ExcelJS from "exceljs";

function setWorkbookMetadata(workbook) {
  workbook.creator = "Bank Statement Convertor";
  workbook.created = new Date();
  workbook.modified = new Date();
}

function styleHeader(row) {
  row.height = 23.25;
  row.eachCell((cell) => {
    cell.font = {
      name: "Calibri",
      family: 2,
      scheme: "minor",
      bold: true,
      size: 18,
      color: { theme: 1 },
    };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      left: { style: "thin" },
      right: { style: "thin" },
      top: { style: "thin" },
      bottom: { style: "thin" },
    };
  });
}

function styleTotalRow(row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = {
      left: { style: "thin" },
      right: { style: "thin" },
      top: { style: "thin" },
      bottom: { style: "thin" },
    };
  });
}

function getTotals(statement) {
  const transactions = statement.transactions || [];
  const totals = transactions.reduce(
    (result, transaction) => {
      result.withdrawal += Number(transaction.withdrawal || 0);
      result.deposit += Number(transaction.deposit || 0);
      result.closingBalance = transaction.balance;
      return result;
    },
    { withdrawal: 0, deposit: 0, closingBalance: null }
  );

  function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  return {
    source: "calculated",
    withdrawal: roundMoney(totals.withdrawal),
    deposit: roundMoney(totals.deposit),
    closingBalance:
      totals.closingBalance === null ? null : roundMoney(totals.closingBalance),
  };
}

function addTransactionsSheet(workbook, transactions, totals) {
  const sheet = workbook.addWorksheet("EXTRACT");
  sheet.columns = [
    { header: "DATE", key: "date", width: 12.57 },
    { header: "NARRATION", key: "particulars", width: 23.14 },
    { header: "DR (WITHDRAWALS/PAYMENTS)", key: "withdrawal", width: 49.29 },
    { header: "CR (DEPOSITS/RECEIPTS)", key: "deposit", width: 37.14 },
    { header: "CLOSING BALANCE", key: "balance", width: 28.43 },
  ];

  styleHeader(sheet.getRow(1));
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const transaction of transactions) {
    sheet.addRow({
      date: transaction.date,
      particulars: transaction.particulars,
      withdrawal: transaction.withdrawal,
      deposit: transaction.deposit,
      balance: transaction.balance,
    });
  }

  const totalRow = sheet.addRow({
    date: null,
    particulars: "GRAND TOTAL",
    withdrawal: totals.withdrawal,
    deposit: totals.deposit,
    balance: totals.closingBalance,
  });

  sheet.getColumn("date").numFmt = "dd-mm-yyyy";
  for (const key of ["withdrawal", "deposit", "balance"]) {
    sheet.getColumn(key).numFmt = '#,##0.00;[Red]-#,##0.00;"-"';
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = {
        left: { style: "thin" },
        right: { style: "thin" },
        top: { style: "thin" },
        bottom: { style: "thin" },
      };
    });
  });

  styleTotalRow(totalRow);
}

function addSummarySheet(workbook, statement) {
  const sheet = workbook.addWorksheet("SUMMARY");
  sheet.columns = [
    { header: "KEY", key: "key", width: 36 },
    { header: "WITHDRAWAL", key: "withdrawal", width: 20 },
    { header: "DEPOSIT", key: "deposit", width: 20 },
    { header: "CLOSING BALANCE", key: "closing", width: 20 },
  ];

  const calculated = getTotals(statement);
  const printed = (statement && statement.printedTotals) || null;

  sheet.addRow({ key: "Calculated (from transactions)", withdrawal: calculated.withdrawal, deposit: calculated.deposit, closing: calculated.closingBalance });

  if (printed) {
    sheet.addRow({ key: "Printed (on statement)", withdrawal: printed.withdrawal, deposit: printed.deposit, closing: printed.closingBalance });
    const mismatch = (
      Math.abs((calculated.withdrawal || 0) - (printed.withdrawal || 0)) > 0.01 ||
      Math.abs((calculated.deposit || 0) - (printed.deposit || 0)) > 0.01 ||
      (calculated.closingBalance !== null && printed.closingBalance !== null && Math.abs(calculated.closingBalance - printed.closingBalance) > 0.01)
    );

    sheet.addRow({ key: "Mismatch", withdrawal: mismatch ? "YES" : "NO", deposit: "", closing: "" });
  } else {
    sheet.addRow({ key: "Printed (on statement)", withdrawal: "N/A", deposit: "N/A", closing: "N/A" });
  }

  sheet.getColumn("withdrawal").numFmt = '#,##0.00;[Red]-#,##0.00;"-"';
  sheet.getColumn("deposit").numFmt = '#,##0.00;[Red]-#,##0.00;"-"';
  sheet.getColumn("closing").numFmt = '#,##0.00;[Red]-#,##0.00;"-"';

  sheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    if (rowNumber === 1) styleHeader(row);
  });
}

async function buildWorkbookBuffer(statement) {
  const workbook = new ExcelJS.Workbook();
  setWorkbookMetadata(workbook);
  addTransactionsSheet(workbook, statement.transactions, getTotals(statement));
  addSummarySheet(workbook, statement);

  return workbook.xlsx.writeBuffer();
}

async function writeWorkbookFile(statement, outputPath) {
  const workbook = new ExcelJS.Workbook();
  setWorkbookMetadata(workbook);
  addTransactionsSheet(workbook, statement.transactions, getTotals(statement));
  addSummarySheet(workbook, statement);
  // Log mismatch to console if printed totals differ from calculated totals
  if (statement && statement.printedTotals) {
    const calc = getTotals(statement);
    const printed = statement.printedTotals;
    const withdrawDiff = Math.abs((calc.withdrawal || 0) - (printed.withdrawal || 0));
    const depositDiff = Math.abs((calc.deposit || 0) - (printed.deposit || 0));
    const closingDiff = (calc.closingBalance !== null && printed.closingBalance !== null) ? Math.abs(calc.closingBalance - printed.closingBalance) : 0;
    if (withdrawDiff > 0.01 || depositDiff > 0.01 || closingDiff > 0.01) {
      // eslint-disable-next-line no-console
      console.warn("Printed totals differ from calculated totals:", { withdrawDiff, depositDiff, closingDiff });
    }
  }

  await workbook.xlsx.writeFile(outputPath);
}

export { buildWorkbookBuffer, writeWorkbookFile };
