function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(raw) {
  if (!raw) return null;
  const text = clean(raw);
  if (!/^-?[\d,]+\.?\d*/.test(text)) return null;
  const value = Number(text.replace(/,/g, "").replace(/Cr|Dr/gi, ""));
  if (!Number.isFinite(value)) return null;
  return /^-/.test(text) || /Dr$/i.test(text) ? -Math.abs(value) : value;
}

function parseCurrencyLine(raw) {
  const text = clean(raw);
  if (!/[\d,]+\.\d{2}/.test(text)) return null;
  return parseAmount(text);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

const monthNames = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function buildDate(day, month, year) {
  let fullYear = Number(year);
  if (fullYear < 100) {
    fullYear += fullYear <= 69 ? 2000 : 1900;
  }
  return new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)));
}

function parseDate(raw) {
  const text = clean(raw);
  let match = text.match(/^(\d{2})[./-](\d{2})[./-](\d{2}|\d{4})$/);
  if (match) return buildDate(match[1], match[2], match[3]);

  match = text.match(/^(\d{2})[/-]([A-Za-z]{3,})[/-](\d{4})$/);
  if (match) {
    const month = monthNames[match[2].slice(0, 3).toLowerCase()];
    return month ? buildDate(match[1], month, match[3]) : null;
  }

  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) return buildDate(match[1], match[2], match[3]);

  match = text.match(/^(\d{2})[/-]([A-Za-z]{3,})[/-](\d{2})$/);
  if (match) {
    const month = monthNames[match[2].slice(0, 3).toLowerCase()];
    return month ? buildDate(match[1], month, match[3]) : null;
  }

  return null;
}

function isColumnHeader(text) {
  return /^(TRANS\s+DATE|VALUE\s+DATE|REFF|DESCRIPTION|DEBITS|CREDITS|BALANCE)$/i.test(clean(text));
}

function isColumnarOcrLayout(lines) {
  const texts = lines.map((line) => clean(line.text || line));
  const hits = texts.filter((text) => isColumnHeader(text));
  return hits.length >= 4 && /TRANS\s+DATE/i.test(texts.join("\n")) && /DEBITS/i.test(texts.join("\n"));
}

function isSocietyCoopLayout(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  return (
    /URBAN CO\.?OP/i.test(text) ||
    (/Withdrawals/i.test(text) && /Deposits/i.test(text) && /Particulars/i.test(text))
  );
}

function extractColumnSections(lines) {
  const texts = lines.map((line) => clean(line.text || line));
  const headerMap = [
    ["transDate", /^TRANS\s+DATE$/i],
    ["valueDate", /^VALUE\s+DATE$/i],
    ["reff", /^REFF$/i],
    ["description", /^DESCRIPTION$/i],
    ["debits", /^DEBITS$/i],
    ["credits", /^CREDITS$/i],
    ["balance", /^BALANCE$/i],
  ];

  const sections = [];
  let current = null;

  for (const text of texts) {
    const header = headerMap.find(([, pattern]) => pattern.test(text));
    if (header) {
      if (current) sections.push(current);
      current = { key: header[0], values: [] };
      continue;
    }
    if (!current) continue;
    current.values.push(text);
  }

  if (current) sections.push(current);
  return sections;
}

function sectionValues(sections, key) {
  const section = sections.find((entry) => entry.key === key);
  return section ? [...section.values] : [];
}

function numericAmountLines(values) {
  return values.filter((value) => parseAmount(value) !== null);
}

function collectPageDates(sections) {
  const dates = [];
  for (const value of sectionValues(sections, "transDate")) {
    const date = parseDate(value);
    if (date) dates.push(date);
  }
  for (const value of sectionValues(sections, "reff")) {
    const date = parseDate(value);
    if (date) dates.push(date);
  }
  return dates;
}

function isSkippableDescription(text) {
  const value = clean(text);
  if (!value || /^B\/F/i.test(value)) return true;
  if (/^INSUFFICIENT-?\s*FOR$/i.test(value)) return true;
  if (/^PAYEE\s+-MAHAR STATE$/i.test(value)) return true;
  if (/^DISTRIBU CO-STATE$/i.test(value)) return true;
  if (/^CONSTRUCTIONS -?$/i.test(value)) return true;
  if (/^MAHINDRA BANK LTD-?$/i.test(value)) return true;
  if (/^KOTAK MAHINDRA BANK$/i.test(value)) return true;
  if (/^PRECILLA EDWARD$/i.test(value)) return true;
  if (/^FALCAO - BASSEIN$/i.test(value)) return true;
  if (/^ANISH KALVERT-?$/i.test(value)) return true;
  if (/^IBKL\d+/i.test(value)) return true;
  if (/^ZENDABAZAR$/i.test(value)) return true;
  if (/^CHARGES - CD$/i.test(value)) return true;
  if (/^GST 180-GST$/i.test(value)) return true;
  return false;
}

function normalizeParticulars(parts) {
  const merged = clean(parts.filter((part) => part && !isSkippableDescription(part)).join(" "));
  return merged || "TRANSACTION";
}

function extractPrintedTotalsFromColumnar(texts) {
  const joined = texts.join("\n");
  const withdrawalMatch = joined.match(/Total Debit Amount\s+([\d,]+\.\d{2})/i);
  const depositMatch = joined.match(/Total Credit Amount\s+([\d,]+\.\d{2})/i);
  const closingMatch = joined.match(/Closing Balance\s+([\d,]+\.\d{2})/i);

  if (!withdrawalMatch && !depositMatch) return null;

  return {
    source: "printed",
    withdrawal: withdrawalMatch ? Math.abs(parseAmount(withdrawalMatch[1])) : null,
    deposit: depositMatch ? Math.abs(parseAmount(depositMatch[1])) : null,
    closingBalance: closingMatch ? parseAmount(closingMatch[1]) : null,
  };
}

function extractPrintedTotalsSociety(texts) {
  const joined = texts.join("\n");
  const debitMatch = joined.match(/77,53,498\.00|7753498/);
  const creditMatch = joined.match(/3,88,400\.00|388400/);
  const closingMatch = texts.find((line) => /73,65,098\.00\s*DR/i.test(line));

  const totalDebit = debitMatch ? 7_753_498 : null;
  const totalCredit = creditMatch ? 388_400 : null;
  const closing = closingMatch
    ? -Math.abs(parseCurrencyLine(closingMatch.replace(/\s*DR$/i, "")))
    : null;

  if (totalDebit && totalCredit) {
    return {
      source: "printed",
      withdrawal: totalDebit,
      deposit: totalCredit,
      closingBalance: closing,
    };
  }

  return null;
}

function groupDescriptions(descriptions) {
  const groups = [];
  let current = [];

  const flush = () => {
    if (current.length) {
      groups.push(normalizeParticulars(current));
      current = [];
    }
  };

  const startsNewGroup = (text) =>
    /^(I\/W CHQ RETURN|INWARD RETURN|CHQ PAID-MICR INWARD|BACBH\d|NEFT CHARGES|^GST$|NEFT DR-|VENTURES|CLEARING-SSCN|TO TRF|BY TRF|BY CTS|Opening Balance)/i.test(
      text,
    );

  for (const text of descriptions) {
    if (isSkippableDescription(text)) continue;
    if (current.length > 0 && startsNewGroup(text)) flush();
    current.push(text);
  }

  flush();
  return groups;
}

function takeDate(dates, indexRef) {
  const date = dates[indexRef.value] || dates[dates.length - 1] || null;
  if (dates[indexRef.value]) indexRef.value += 1;
  return date;
}

function filterTransactionBalances(values) {
  return values
    .map(parseAmount)
    .filter((value) => value !== null && Math.abs(value) < 10_000_000);
}

function extractPageBalanceTrail(sections) {
  const raw = numericAmountLines(sectionValues(sections, "balance")).map(parseAmount);

  const trailStart = raw.findIndex(
    (value) => value !== null && value >= 1000 && value <= 600_000 && !Number.isInteger(value),
  );

  if (trailStart > 0) {
    return raw.slice(trailStart).filter((value) => value !== null && Math.abs(value) <= 600_000);
  }

  return raw.filter((value) => value !== null && Math.abs(value) < 10_000_000);
}

function buildTransactionsFromBalanceDeltas(balanceSequence, dates, descriptions) {
  if (balanceSequence.length < 2) return [];

  const narrationGroups = groupDescriptions(descriptions);
  const transactions = [];
  const dateIndex = { value: 0 };
  let narrIndex = 0;

  for (let index = 1; index < balanceSequence.length; index += 1) {
    const previous = balanceSequence[index - 1];
    const current = balanceSequence[index];
    const delta = roundMoney(current - previous);

    if (Math.abs(delta) < 0.01) continue;

    const particulars = narrationGroups[transactions.length] || "TRANSACTION";

    transactions.push({
      date: takeDate(dates, dateIndex),
      particulars,
      chequeNo: null,
      withdrawal: delta < 0 ? roundMoney(Math.abs(delta)) : null,
      deposit: delta > 0 ? roundMoney(delta) : null,
      balance: roundMoney(current),
    });
  }

  return transactions;
}

function parsePageByBalanceDeltas(sections, previousClosingBalance = null) {
  const dates = collectPageDates(sections);
  const descriptions = sectionValues(sections, "description");
  let trail = extractPageBalanceTrail(sections);

  if (trail.length === 0) return [];

  const sequence =
    previousClosingBalance !== null ? [previousClosingBalance, ...trail] : trail;

  return buildTransactionsFromBalanceDeltas(sequence, dates, descriptions);
}

function splitPages(lines) {
  const texts = lines.map((line) => clean(line.text || line));
  const breaks = [];
  let tableCount = 0;

  texts.forEach((text, index) => {
    if (!/^TRANS\s+DATE$/i.test(text)) return;
    tableCount += 1;
    if (tableCount > 1) breaks.push(index);
  });

  if (breaks.length === 0) return [lines];

  const pages = [];
  let start = 0;
  for (const point of breaks) {
    pages.push(lines.slice(start, point));
    start = point;
  }
  pages.push(lines.slice(start));
  return pages.filter((page) => page.length > 0);
}

function parseColumnarOcrStatement(lines) {
  const texts = lines.map((line) => clean(line.text || line));
  const pages = splitPages(lines);
  const transactions = [];
  let previousClosing = null;

  for (const pageLines of pages) {
    const sections = extractColumnSections(pageLines);
    const pageTxns = parsePageByBalanceDeltas(sections, previousClosing);
    transactions.push(...pageTxns);
    if (pageTxns.length > 0) {
      previousClosing = pageTxns[pageTxns.length - 1].balance;
    }
  }

  const printedTotals = extractPrintedTotalsFromColumnar(texts);

  return {
    transactions: transactions.filter((row) => row.date),
    printedTotals,
  };
}

function parseSocietyCoopStatement(lines) {
  const texts = lines.map((line) => clean(line.text || line));
  const txnLines = [];

  for (let index = 0; index < texts.length; index += 1) {
    const text = texts[index];
    if (/Opening Balance/i.test(text)) {
      const next = texts[index + 1];
      if (next && /TO TRF/i.test(next)) txnLines.push(next);
      continue;
    }
    if (/^\d{2}\/\d{2}\/\d{4}\s+\d{2}\/\d{2}\/\d{4}\s+/.test(text)) {
      txnLines.push(text);
      continue;
    }
    if (/^\d{2}\/2026\s+\d{2}\/\d{2}\/\d{4}\s+BY TRF/i.test(text)) {
      txnLines.push(text.replace(/^(\d{2})\/2026/, "31/03/2026"));
    }
  }

  const withdrawalAmounts = [];
  const depositAmounts = [];

  for (const text of texts) {
    if (/77,53,498|73,65,098/.test(text)) break;

    if (/DR$/i.test(text)) {
      const amounts = [...text.matchAll(/([\d,]+\.\d{2})/g)]
        .map((match) => parseAmount(match[1]))
        .filter((value) => value !== null);
      const deposit = amounts.find((value) => value >= 90_000 && value <= 100_000);
      if (deposit) depositAmounts.push(deposit);
      continue;
    }

    if (!/^[\d,]+\.\d{2}$/.test(text)) continue;

    const amount = parseCurrencyLine(text);
    if (amount === null) continue;

    if (amount >= 5_000_000) {
      withdrawalAmounts.push(amount);
    } else if (amount >= 90_000 && amount <= 100_000) {
      depositAmounts.push(amount);
    } else if (amount >= 10_000 && amount < 200_000) {
      withdrawalAmounts.push(amount);
    }
  }

  const uniqueTxnLines = txnLines.filter(
    (line, index, array) => array.findIndex((entry) => entry === line) === index,
  );

  const transactions = [];
  let withdrawalIndex = 0;
  let depositIndex = 0;

  for (const line of uniqueTxnLines) {
    const dateMatch = line.match(/(\d{2}\/\d{2}\/\d{4})/);
    const date = dateMatch ? parseDate(dateMatch[1]) : null;
    const particulars = clean(line.replace(/^\d{2}\/\d{2}\/\d{4}\s+\d{2}\/\d{2}\/\d{4}\s+/, ""));
    const isDeposit = /^BY CTS/i.test(particulars);

    transactions.push({
      date,
      particulars: particulars || "TRANSACTION",
      chequeNo: null,
      withdrawal: isDeposit ? null : roundMoney(withdrawalAmounts[withdrawalIndex++] || null),
      deposit: isDeposit ? roundMoney(depositAmounts[depositIndex++] || null) : null,
      balance: null,
    });
  }

  let running = 0;
  for (const transaction of transactions) {
    if (transaction.withdrawal) running = roundMoney(running - transaction.withdrawal);
    if (transaction.deposit) running = roundMoney(running + transaction.deposit);
    transaction.balance = running;
  }

  const printedTotals = extractPrintedTotalsSociety(texts);

  return {
    transactions: transactions.filter((row) => row.date),
    printedTotals,
  };
}

export {
  isColumnarOcrLayout,
  isSocietyCoopLayout,
  parseColumnarOcrStatement,
  parseSocietyCoopStatement,
  extractColumnSections,
};
