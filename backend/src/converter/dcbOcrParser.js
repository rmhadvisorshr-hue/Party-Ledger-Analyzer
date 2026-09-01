// DCB Bank scanned-statement OCR layout.
//
// DCB's dense, small-print, ruled "Date | Transaction Details | Cheque
// Number | Withdrawals | Deposits | Balance" table -- especially when the
// source is a photocopy/phone-scan with handwritten audit ticks pressed
// right up against the printed figures -- routinely gets segmented by
// Tesseract into MORE "lines" than there are physical rows: a row's date
// and narration land on one line while its amount and running balance land
// on a separate line a little further down (with junk single-character
// fragments from the ink annotations sorted in between). The shared
// row-per-line engine in parser.ts requires date + at least one amount on
// the SAME line, so it silently drops every row that got split this way.
//
// This parser instead walks the OCR lines as a small state machine: a
// date-bearing line with no amount yet becomes a *pending* row that keeps
// absorbing narration/noise until an amount-bearing line arrives to
// complete it (or a new date line arrives first, in which case the
// unresolved pending row is dropped rather than guessed at). Every
// completed row is then required to reconcile against the running
// balance -- computed strictly from each row's own printed balance, never
// inferred -- before being accepted, so a misread digit produces a gap in
// the output rather than a silently wrong figure.

function clean(value) {
  return String(value || "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(raw) {
  const text = clean(raw).replace(/,/g, "");
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function isDcbLayout(lines) {
  // The "DCB BANK" banner is a stylised logo image on every page, which a
  // scanned/photocopied source frequently fails to OCR as clean adjacent
  // text at all (even when the rest of the page reads fine) -- so this
  // checks the whole document for DCB's IFSC prefix and boilerplate
  // instead of relying on the banner text specifically.
  const text = lines
    .map((line) => clean(line.text || line))
    .join(" ")
    .toUpperCase();
  return /\bDCBL0\d{6}\b/.test(text) || /DCB\s*BANK/.test(text) || /DCB\s+BANK\s+LIMITED/.test(text);
}

// Tolerant of the separator sometimes being dropped/misread by OCR
// ("1809-2025" for "18-09-2025") -- captured loosely, then validated by
// actually constructing a date and range-checking it below.
const DATE_RE = /\b(\d{2})[.\-/]?(\d{2})[.\-/]?(\d{4})\b/;
const AMOUNT_RE = /-?\d{1,3}(?:,\d{2,3})+\.\d{2}|-?\d{4,}\.\d{2}|-?\d{2,3}\.\d{2}/g;

// The statement's own header states the period as 01-04-2025 to
// 31-03-2026; any OCR'd date has to fall in that range or it's rejected
// outright rather than guessed at.
const STATEMENT_START = Date.UTC(2025, 3, 1);
const STATEMENT_END = Date.UTC(2026, 2, 31);

function tryBuildDate(day, month, year) {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!(d >= 1 && d <= 31) || !(m >= 1 && m <= 12)) return null;
  const ts = Date.UTC(y, m - 1, d);
  if (Number.isNaN(ts) || ts < STATEMENT_START || ts > STATEMENT_END) return null;
  // Reject silently-invalid calendar dates (e.g. day 31 in a 30-day month)
  // rather than let JS Date normalize them into a different day.
  const check = new Date(ts);
  if (check.getUTCDate() !== d || check.getUTCMonth() !== m - 1 || check.getUTCFullYear() !== y) return null;
  return new Date(ts);
}

function extractDate(text) {
  const match = DATE_RE.exec(text);
  DATE_RE.lastIndex = 0;
  if (!match) return null;
  const date = tryBuildDate(match[1], match[2], match[3]);
  return date ? { date, start: match.index, end: match.index + match[0].length } : null;
}

// A bare "DD.MM"-shaped number (no comma grouping, 2-digit integer part
// <=31, 2-digit fraction <=12) is indistinguishable in this exact format
// from a real small rupee amount -- and on this heavily corrupted OCR text,
// it is overwhelmingly a mangled leftover date fragment (a dropped year, a
// repeated value-date, a reference-number tail) rather than money: every
// row that produced one of these as its "balance" turned out to have a
// wildly implausible balance jump against its neighbours. Genuine amounts
// with 3+ integer digits or comma grouping are unaffected.
function looksLikeDateFragment(raw) {
  const match = /^-?(\d{1,2})\.(\d{2})$/.exec(raw);
  if (!match) return false;
  const day = Number(match[1]);
  const month = Number(match[2]);
  return day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

function extractAmounts(text) {
  const matches = [...text.matchAll(AMOUNT_RE)];
  return matches
    .map((match) => ({ raw: match[0], index: match.index, value: parseAmount(match[0]) }))
    .filter((amount) => amount.value !== null && !looksLikeDateFragment(amount.raw));
}

// Ink-annotation noise reliably OCRs as very short, mostly-symbolic
// fragments ("a", "©", "[@]", "Z;") -- never a real narration token in an
// English-language statement -- so they're dropped rather than glued onto
// a row's narration text.
function looksLikeJunkFragment(text) {
  const value = clean(text);
  if (!value) return true;
  if (value.length <= 2) return true;
  if (!/[A-Za-z]{3,}/.test(value) && !/\d/.test(value)) return true;
  return false;
}

function finalizeRow(pending) {
  if (pending.amounts.length === 0) return null;

  const balance = pending.amounts[pending.amounts.length - 1].value;
  const transactionAmount =
    pending.amounts.length >= 2 ? Math.abs(pending.amounts[pending.amounts.length - 2].value) : null;

  return {
    date: pending.date,
    particulars: clean(pending.narrationParts.join(" ")) || "TRANSACTION",
    chequeNo: null,
    balance,
    transactionAmount,
  };
}

function classifyAgainstRunningBalance(row, previousBalance) {
  if (previousBalance === null) {
    // No confirmed prior balance to diff against yet (start of the
    // statement, or every row since the last confirmed one was rejected) --
    // there's no way to verify direction, so this row can't be accepted
    // without guessing. It's surfaced separately rather than silently
    // dropped so the caller can decide whether to seed from it.
    return null;
  }

  const delta = roundMoney(row.balance - previousBalance);
  if (row.transactionAmount === null) {
    // Only a balance was recovered for this row, no transaction amount --
    // still useful as a fresh balance anchor, but not a bookable
    // transaction line on its own.
    return null;
  }

  const TOLERANCE = 0.05;
  if (Math.abs(delta - row.transactionAmount) <= TOLERANCE) {
    return { withdrawal: null, deposit: row.transactionAmount };
  }
  if (Math.abs(delta + row.transactionAmount) <= TOLERANCE) {
    return { withdrawal: row.transactionAmount, deposit: null };
  }
  return "MISMATCH";
}

function collectDcbRows(lines) {
  const texts = lines.map((line) => clean(line.text || line));

  // A row's date and narration commonly land on one OCR line while its
  // transaction amount and/or balance trail on one or two more lines below
  // it (see module comment) -- so a pending row keeps absorbing amounts
  // from every following line, however many there are, until the *next*
  // date starts a new row. Only at that point is it finalized, using
  // whichever amounts it accumulated (last one = balance, one before that
  // = the transaction amount, extras before that are most likely OCR
  // noise misread as a number and are ignored).
  let pending = null; // { date, narrationParts: [], amounts: [] }
  const completedRows = [];

  const flushPending = () => {
    if (!pending) return;
    const row = finalizeRow(pending);
    if (row) completedRows.push(row);
    pending = null;
  };

  for (let i = 0; i < texts.length; i += 1) {
    const text = texts[i];
    if (!text) continue;

    const dateHit = extractDate(text);
    const amounts = extractAmounts(text);
    const remainder = dateHit ? clean(text.slice(0, dateHit.start) + " " + text.slice(dateHit.end)) : text;
    const narrationText = amounts.length > 0 ? clean(remainder.replace(AMOUNT_RE, " ")) : remainder;

    if (dateHit) {
      // A new row starts here -- whatever the previous pending row
      // accumulated is everything it's going to get.
      flushPending();
      pending = {
        date: dateHit.date,
        narrationParts: narrationText && !looksLikeJunkFragment(narrationText) ? [narrationText] : [],
        amounts: [...amounts],
      };
      continue;
    }

    if (!pending) {
      // Orphan amount-only or noise line with no row to attach to.
      continue;
    }

    if (amounts.length > 0) {
      pending.amounts.push(...amounts);
      if (!looksLikeJunkFragment(narrationText)) pending.narrationParts.push(narrationText);
    } else if (!looksLikeJunkFragment(text)) {
      pending.narrationParts.push(text);
    }
  }

  flushPending();
  return completedRows;
}

function parseDcbOcrStatement(lines, openingBalance = null) {
  const completedRows = collectDcbRows(lines);

  // Reconcile every completed row against the running balance, seeded from
  // the statement's own printed opening balance when available. Rows that
  // don't cleanly reconcile (misread digit, missed row, etc.) are excluded
  // rather than included with a guessed sign or amount; `skipped` reports
  // how many so the gap is visible instead of silent.
  const transactions = [];
  let running = openingBalance;
  let skipped = 0;

  for (const row of completedRows) {
    const classification = classifyAgainstRunningBalance(row, running);

    if (classification === "MISMATCH") {
      // The balance jump doesn't match this row's own amount against the
      // running total we trust so far -- likely a misread digit somewhere
      // upstream. Re-anchor on this row's printed balance (still real,
      // taken from the page, not invented) so a single bad row doesn't
      // cascade into rejecting everything after it, but don't book a
      // transaction we can't verify.
      running = row.balance;
      skipped += 1;
      continue;
    }

    if (classification === null) {
      running = row.balance;
      if (row.transactionAmount !== null) skipped += 1;
      continue;
    }

    transactions.push({
      date: row.date,
      particulars: row.particulars,
      chequeNo: null,
      withdrawal: classification.withdrawal,
      deposit: classification.deposit,
      balance: row.balance,
    });
    running = row.balance;
  }

  return { transactions, skipped, totalRowsFound: completedRows.length };
}

export { isDcbLayout, parseDcbOcrStatement, collectDcbRows };
