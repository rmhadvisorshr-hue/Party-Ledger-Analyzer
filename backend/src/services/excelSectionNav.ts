import { SECTION_TITLE_LABELS } from "./excelSheetStyles";

export type RawSheetRows = Array<Array<string | number | null>>;

function cellText(value: string | number | null | undefined): string {
  if (value == null) return "";
  return String(value).trim();
}

function sheetWidth(rows: RawSheetRows): number {
  return Math.max(5, ...rows.map((row) => row.length));
}

function isEmptyRow(row: RawSheetRows[number] | undefined): boolean {
  if (!row?.length) return true;
  return row.every((cell) => cellText(cell) === "");
}

function getSectionTitleInRow(row: RawSheetRows[number]): string | null {
  for (const cell of row) {
    const text = cellText(cell);
    if (SECTION_TITLE_LABELS.has(text)) return text;
  }
  const first = cellText(row[0]);
  if (SECTION_TITLE_LABELS.has(first)) return first;
  return null;
}

function isSectionTitleRow(row: RawSheetRows[number]): boolean {
  return getSectionTitleInRow(row) !== null;
}

/** Remove Index / Go to top from header rows (keeps client name + account line in column A). */
function stripInlineNavLabels(row: RawSheetRows[number]): RawSheetRows[number] {
  return row.map((cell) => {
    const text = cellText(cell);
    if (text === "Index" || text === "Go to top") return null;
    return cell;
  });
}

/** Dedicated nav pair placed above each section (Index / Go to top in last column, Accumn-style). */
function buildSectionNavRows(width: number): RawSheetRows {
  const navCol = width - 1;
  const indexRow = Array(width).fill(null);
  const topRow = Array(width).fill(null);
  indexRow[navCol] = "Index";
  topRow[navCol] = "Go to top";
  return [indexRow, topRow];
}

function trailingRowsAreSectionNav(rows: RawSheetRows): boolean {
  if (rows.length < 2) return false;
  const width = sheetWidth(rows);
  const navCol = width - 1;
  const indexRow = rows[rows.length - 2];
  const topRow = rows[rows.length - 1];
  return (
    cellText(indexRow[navCol]) === "Index" &&
    cellText(topRow[navCol]) === "Go to top" &&
    indexRow.filter((c) => cellText(c)).length === 1 &&
    topRow.filter((c) => cellText(c)).length === 1
  );
}

function trimTrailingEmpty(rows: RawSheetRows): void {
  while (rows.length > 0 && isEmptyRow(rows[rows.length - 1])) {
    rows.pop();
  }
}

/**
 * Preserve sheet header rows (client + account). Add Index / Go to top only above each section.
 */
export function prepareSheetRowsWithSectionNav(rows: RawSheetRows): RawSheetRows {
  if (!rows.length) return rows;

  const width = sheetWidth(rows);
  const prepared: RawSheetRows = [];

  for (const row of rows) {
    if (isSectionTitleRow(row)) {
      trimTrailingEmpty(prepared);
      if (!trailingRowsAreSectionNav(prepared)) {
        prepared.push(...buildSectionNavRows(width));
      }
      prepared.push(row);
      continue;
    }

    prepared.push(stripInlineNavLabels(row));
  }

  return prepared;
}
