import type ExcelJS from "exceljs";

/** Accumn-style palette */
export const EXCEL_THEME = {
  primary: "FF1F4E79",
  headerBar: "FF4F81BD",
  headerBg: "FFE9EDF5",
  sectionBg: "FF4F81BD",
  navBg: "FFE9EDF5",
  zebra: "FFF7F9FC",
  white: "FFFFFFFF",
  subtotalBg: "FFF2F2F2",
  border: "FFD0D7E2",
  borderStrong: "FFB4C6E7",
  link: "FF0563C1",
  text: "FF333333",
} as const;

export const INR_NUM_FMT = '#,##0.00;[Red]-#,##0.00;"-"';
export const DATE_NUM_FMT = "dd-mmm-yyyy";
export const PCT_NUM_FMT = "0.0%";

const THIN = { style: "thin" as const, color: { argb: EXCEL_THEME.border } };
export const CELL_BORDER = {
  top: THIN,
  left: THIN,
  bottom: THIN,
  right: THIN,
};

const AMOUNT_HEADER =
  /^(debit|credit|balance|amount|net|total|opening|closing|avg|min|max|emi|paid|due|withdrawal|deposit|inflow|outflow|charges?|return|salary|spent|count|no\.?\s*of|txn)/i;

const DATE_HEADER = /^(date|month-year|month|cleared\s*date|paid\s*on|last\s*seen)/i;

const SUBTOTAL_LABELS = new Set([
  "Deposits",
  "Withdrawals",
  "Net Cash Flows",
  "Closing Balance",
  "Min EOD Balance",
  "Max EOD Balance",
  "Avg EOD Balance",
  "Net Debit Amount",
  "Net Credit Amount",
]);

export const SECTION_TITLE_LABELS = new Set([
  "Month Wise Balance and Transaction Summary",
  "Month Wise Bounce and Charges Summary",
  "Month Wise Loan Payments",
  "Internal & Non-Trade Related Party Transaction",
  "Mode Wise Transactions",
  "Bounce and Charge Summary",
  "Bounce and Charge Instances",
  "Loan Credit Instances",
  "EMI Debit Instances",
  "Interest Servicing Instances",
  "EMI",
  "Party Wise Credits (Rank wise)",
  "Party Wise Debits (Rank wise)",
  "10 Highest Debit Transactions",
  "10 Highest Credit Transactions",
  "Party Wise Internal and Related Party Debits",
  "Party Wise Internal and Related Party Credits",
  "Internal txn instances",
  "Party Wise Debit(Circular)",
  "Party Wise Credit(Circular)",
  "Circular txn instances",
  "Net Debit Amount",
  "Net Credit Amount",
  "Summary of Salary",
  "Salary Credit Instances",
  "Summary of Salary Debited",
  "Salary Debit Instances",
  "Summary of Spend Analysis",
  "Summary of Utility Bill Payments",
  "Summary of Statutory Payments",
  "Executive Summary",
  "Raw Data",
  "Bounce and Charge Summary",
  "Bounce and Charge Instances",
  "Loan Credit Instances",
  "BANKING_AND_ABB",
  "Month Wise Loan Payments",
  "EMI",
  "Summary of Statutory Payments",
]);

export const COLUMN_HEADER_LABELS = new Set([
  "Particulars",
  "SN",
  "Month-Year",
  "Ranking",
  "DATE",
  "Name of FI",
  "Flag Category",
  "Flag",
  "Flag  Description",
  "Flag Description",
  "Flag Colour",
  "Category",
  "Description",
  "Payment Category",
  "Mode Of Transaction",
  "Bank Name",
  "Account Number",
  "SHEETS",
  "Counterparty",
  "Transaction Modes",
  "No. of Transactions",
  "Debit Amount",
  "Credit Amount",
  "Net Transaction",
  "Confidence",
  "Party Name",
  "Type",
  "Mode",
  "Debit",
  "Credit",
  "Narration",
  "Balance",
  "Irregularity Indicators",
  "Identified?",
  "Triggers",
]);

type ColumnKind = "amount" | "date" | "text" | "serial";

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "object" && value !== null && "text" in value) {
    return String((value as { text?: string }).text ?? "");
  }
  return String(value);
}

function isNavRow(row: ExcelJS.Row): boolean {
  let hasIndex = false;
  let hasTop = false;
  row.eachCell({ includeEmpty: false }, (cell) => {
    const text = cellText(cell.value);
    if (text === "Index") hasIndex = true;
    if (text === "Go to top") hasTop = true;
  });
  return hasIndex || hasTop;
}

function isDedicatedNavRow(row: ExcelJS.Row): boolean {
  let linkLabel = "";
  let otherContent = 0;
  row.eachCell({ includeEmpty: false }, (cell) => {
    const text = cellText(cell.value);
    if (text === "Index" || text === "Go to top") linkLabel = text;
    else if (text) otherContent += 1;
  });
  return Boolean(linkLabel) && otherContent === 0;
}

function sectionTitleInRow(row: ExcelJS.Row): string | null {
  let found: string | null = null;
  row.eachCell({ includeEmpty: false }, (cell) => {
    const text = cellText(cell.value);
    if (SECTION_TITLE_LABELS.has(text)) found = text;
  });
  const first = cellText(row.getCell(1).value);
  if (SECTION_TITLE_LABELS.has(first)) return first;
  return found;
}

function isSectionRow(first: string, row?: ExcelJS.Row): boolean {
  if (SECTION_TITLE_LABELS.has(first)) return true;
  if (row) return sectionTitleInRow(row) !== null;
  return false;
}

function isColumnHeaderRow(row: ExcelJS.Row): boolean {
  const first = cellText(row.getCell(1).value);
  if (COLUMN_HEADER_LABELS.has(first)) return true;
  if (first === "Particulars" || first === "SN" || first === "Month-Year") return true;
  let headerish = 0;
  row.eachCell({ includeEmpty: false }, (cell) => {
    const text = cellText(cell.value);
    if (COLUMN_HEADER_LABELS.has(text) || AMOUNT_HEADER.test(text) || DATE_HEADER.test(text)) {
      headerish += 1;
    }
  });
  return headerish >= 2;
}

function classifyColumns(headerRow: ExcelJS.Row): Map<number, ColumnKind> {
  const map = new Map<number, ColumnKind>();
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const label = cellText(cell.value);
    if (COLUMN_HEADER_LABELS.has(label) && label === "SN") {
      map.set(col, "serial");
    } else if (AMOUNT_HEADER.test(label) || /amount|balance|debit|credit|net/i.test(label)) {
      map.set(col, "amount");
    } else if (DATE_HEADER.test(label)) {
      map.set(col, "date");
    } else {
      map.set(col, "text");
    }
  });
  return map;
}

function isNumericValue(value: ExcelJS.CellValue): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function looksLikeAmountColumn(values: number[]): boolean {
  if (values.length < 2) return values.length === 1;
  const max = Math.max(...values.map(Math.abs));
  return max >= 1 || values.some((v) => !Number.isInteger(v));
}

function styleSectionRow(row: ExcelJS.Row, maxCol: number): void {
  if (maxCol > 1) {
    try {
      row.worksheet.mergeCells(row.number, 1, row.number, maxCol);
    } catch {
      /* already merged */
    }
  }
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: EXCEL_THEME.sectionBg },
    };
    cell.border = CELL_BORDER;
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  });
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { name: "Calibri", bold: true, size: 10, color: { argb: EXCEL_THEME.primary } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: EXCEL_THEME.headerBg },
    };
    cell.border = {
      top: { style: "thin", color: { argb: EXCEL_THEME.borderStrong } },
      bottom: { style: "thin", color: { argb: EXCEL_THEME.borderStrong } },
      left: THIN,
      right: THIN,
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
}

function styleSubtotalRow(row: ExcelJS.Row): void {
  row.font = { name: "Calibri", bold: true, size: 10 };
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: EXCEL_THEME.subtotalBg },
    };
    cell.border = CELL_BORDER;
    if (isNumericValue(cell.value)) {
      cell.numFmt = INR_NUM_FMT;
      cell.alignment = { horizontal: "right", vertical: "middle" };
    }
  });
}

function styleAccountIntroRow(row: ExcelJS.Row, maxCol: number): void {
  const first = cellText(row.getCell(1).value);
  if (first === "Index" || first === "Go to top") return;
  if (SECTION_TITLE_LABELS.has(first) || COLUMN_HEADER_LABELS.has(first)) return;

  row.eachCell({ includeEmpty: true }, (cell, col) => {
    if (col > maxCol) return;
    cell.border = CELL_BORDER;
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: EXCEL_THEME.white },
    };
    if (col === 1 && first) {
      cell.font = {
        name: "Calibri",
        bold: true,
        size: first.startsWith("Account Number") ? 10 : 12,
        color: { argb: EXCEL_THEME.primary },
      };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    }
  });
}

function styleNavRow(row: ExcelJS.Row, maxCol: number): void {
  const dedicated = isDedicatedNavRow(row);

  if (dedicated) {
    let linkLabel = "";
    row.eachCell({ includeEmpty: false }, (cell) => {
      const text = cellText(cell.value);
      if (text === "Index" || text === "Go to top") linkLabel = text;
    });
    if (!linkLabel) return;

    const worksheet = row.worksheet;
    const rowNum = row.number;
    const cell = row.getCell(1);
    const alreadyMerged = cell.isMerged;

    // Only clear/merge when not already merged. Writing to a merged slave cell
    // proxies back to the master and would wipe the nav label on re-styling.
    if (!alreadyMerged && maxCol > 1) {
      for (let col = 2; col <= maxCol; col += 1) {
        row.getCell(col).value = null;
      }
      try {
        worksheet.mergeCells(rowNum, 1, rowNum, maxCol);
      } catch {
        /* already merged */
      }
    }

    cell.value = linkLabel;
    cell.font = {
      name: "Calibri",
      bold: true,
      underline: true,
      color: { argb: EXCEL_THEME.link },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: EXCEL_THEME.navBg },
    };
    cell.border = CELL_BORDER;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
    return;
  }

  row.eachCell({ includeEmpty: true }, (cell, col) => {
    const text = cellText(cell.value);
    if (text === "Index" || text === "Go to top") {
      cell.font = { name: "Calibri", bold: true, underline: true, color: { argb: EXCEL_THEME.link } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
    } else if (col === 1 && text) {
      cell.font = {
        name: "Calibri",
        bold: true,
        size: text.startsWith("Account Number") ? 10 : 12,
        color: { argb: EXCEL_THEME.primary },
      };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    }
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: EXCEL_THEME.navBg },
    };
    cell.border = CELL_BORDER;
  });
}

function styleDataCell(
  cell: ExcelJS.Cell,
  kind: ColumnKind,
  zebra: boolean,
): void {
  cell.border = CELL_BORDER;
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: zebra ? EXCEL_THEME.zebra : EXCEL_THEME.white },
  };
  cell.font = { name: "Calibri", size: 10, color: { argb: EXCEL_THEME.text } };

  if (kind === "amount" || isNumericValue(cell.value)) {
    if (isNumericValue(cell.value)) {
      cell.numFmt = INR_NUM_FMT;
    }
    cell.alignment = { horizontal: "right", vertical: "top", wrapText: false };
    return;
  }

  if (kind === "date") {
    cell.numFmt = DATE_NUM_FMT;
    cell.alignment = { horizontal: "left", vertical: "top", wrapText: false };
    return;
  }

  if (kind === "serial" && isNumericValue(cell.value)) {
    cell.numFmt = "0";
    cell.alignment = { horizontal: "center", vertical: "top" };
    return;
  }

  cell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
}

/**
 * Apply consistent borders, zebra stripes, and number formats across a module sheet.
 */
export function applyConsistentSheetFormatting(worksheet: ExcelJS.Worksheet): void {
  const maxCol = Math.max(
    worksheet.columnCount,
    ...Array.from({ length: worksheet.rowCount }, (_, i) => worksheet.getRow(i + 1).cellCount),
    1,
  );

  const headerRowNumbers: number[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (isColumnHeaderRow(row)) headerRowNumbers.push(rowNumber);
  });

  const columnKindsByHeader = new Map<number, Map<number, ColumnKind>>();
  for (const rowNum of headerRowNumbers) {
    columnKindsByHeader.set(rowNum, classifyColumns(worksheet.getRow(rowNum)));
  }

  function activeColumnKinds(forRow: number): Map<number, ColumnKind> {
    let best: Map<number, ColumnKind> | undefined;
    for (const [headerRow, kinds] of columnKindsByHeader) {
      if (headerRow < forRow) best = kinds;
    }
    return best ?? new Map();
  }

  let dataStripe = 0;

  worksheet.eachRow((row, rowNumber) => {
    const first = cellText(row.getCell(1).value);
    const isEmpty = row.cellCount === 0 || (row.cellCount === 1 && !first);

    if (isEmpty) return;

    if (isNavRow(row)) {
      styleNavRow(row, maxCol);
      return;
    }

    if (
      rowNumber <= 5 &&
      !isSectionRow(first, row) &&
      !isColumnHeaderRow(row) &&
      !SUBTOTAL_LABELS.has(first) &&
      (first || rowNumber <= 2)
    ) {
      styleAccountIntroRow(row, maxCol);
      return;
    }

    if (isSectionRow(first, row)) {
      styleSectionRow(row, maxCol);
      dataStripe = 0;
      return;
    }

    if (SUBTOTAL_LABELS.has(first)) {
      styleSubtotalRow(row);
      return;
    }

    if (headerRowNumbers.includes(rowNumber) || isColumnHeaderRow(row)) {
      styleHeaderRow(row);
      dataStripe = 0;
      return;
    }

    const kinds = activeColumnKinds(rowNumber);
    const numericCols: number[] = [];
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      if (isNumericValue(cell.value)) numericCols.push(col);
    });

    if (numericCols.length > 0 && !columnKindsByHeader.size) {
      const sample = numericCols.map((c) => row.getCell(c).value as number);
      if (looksLikeAmountColumn(sample)) {
        for (const col of numericCols) kinds.set(col, "amount");
      }
    }

    const zebra = dataStripe % 2 === 1;
    dataStripe += 1;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber > maxCol) return;
      let kind = kinds.get(colNumber) ?? "text";
      if (kind === "text" && isNumericValue(cell.value)) {
        kind = "amount";
      }
      styleDataCell(cell, kind, zebra);
    });

    for (let col = 1; col <= maxCol; col += 1) {
      const cell = row.getCell(col);
      if (cell.value == null && !cell.border) {
        styleDataCell(cell, kinds.get(col) ?? "text", zebra);
      }
    }
  });

  worksheet.columns.forEach((column, index) => {
    if (!column.width) {
      if (index === 0) column.width = 30;
      else if (index === 2) column.width = 40;
      else column.width = 14;
    }
  });
}

export function styleIndexSheet(worksheet: ExcelJS.Worksheet): void {
  const header = worksheet.getRow(2);
  styleHeaderRow(header);
  worksheet.getCell("A1").font = {
    name: "Calibri",
    bold: true,
    size: 14,
    color: { argb: EXCEL_THEME.primary },
  };

  let stripe = 0;
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 2) return;
    const zebra = stripe % 2 === 1;
    stripe += 1;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = CELL_BORDER;
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: zebra ? EXCEL_THEME.zebra : EXCEL_THEME.white },
      };
      cell.font = { name: "Calibri", size: 10 };
      if (col === 1) cell.alignment = { horizontal: "center" };
      if (col === 2 && typeof cell.value === "object" && cell.value && "hyperlink" in cell.value) {
        cell.font = { name: "Calibri", size: 10, color: { argb: EXCEL_THEME.link }, underline: true };
      }
    });
  });
}
