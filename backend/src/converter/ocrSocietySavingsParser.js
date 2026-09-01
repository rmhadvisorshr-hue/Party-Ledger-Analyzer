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

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

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
  return null;
}

function isSocietySavingsCompact(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  return (
    /MANICKPUR URBAN/i.test(text) &&
    /Saving Normal/i.test(text) &&
    /\d+\s*\|\s*[\d,.]+\s+\d+\s*\|/i.test(text)
  );
}

function parseSocietySavingsCompact(lines) {
  const texts = lines.map((line) => clean(line.text || line));

  let totalWithdrawal = 0;
  let totalDeposit = null;

  const summaryLine = texts.find((text) => /^\d+\s*\|/.test(text) && text.includes("|"));
  if (summaryLine) {
    const match = summaryLine.match(/([\d,.]+)\s+(\d+)\s*\|\s*([\d,.]+)/);
    if (match) {
      totalWithdrawal = parseAmount(match[1]) || 0;
      totalDeposit = parseAmount(match[3]);
    }
  }

  const crBalances = texts
    .filter((text) => /\sCR$/i.test(text))
    .map((text) => parseAmount(text.replace(/\s*CR$/i, "")))
    .filter((value) => value !== null);

  const closingBalance = crBalances[crBalances.length - 1] ?? null;

  const amounts = [];
  for (const text of texts) {
    if (/^\d+\s*\|/.test(text)) break;
    if (/^[\d,]+\.\d{2}$/.test(text)) {
      const amount = parseAmount(text);
      if (amount !== null) amounts.push(amount);
    }
  }

  const txnLines = texts.filter((text) => /^\d{2}\/\d{2}\/\d{4}\s+\d{2}\/\d{2}\/\d{4}\s+/.test(text));

  const transactions = txnLines.map((line, index) => {
    const dateMatch = line.match(/(\d{2}\/\d{2}\/\d{4})/);
    const date = dateMatch ? parseDate(dateMatch[1]) : null;
    const particulars = clean(line.replace(/^\d{2}\/\d{2}\/\d{4}\s+\d{2}\/\d{2}\/\d{4}\s+/, ""));

    return {
      date,
      particulars: particulars || "TRANSACTION",
      chequeNo: null,
      withdrawal: null,
      deposit: amounts[index] !== undefined ? roundMoney(amounts[index]) : null,
      balance:
        crBalances[index + 1] !== undefined
          ? roundMoney(crBalances[index + 1])
          : closingBalance !== null
            ? roundMoney(closingBalance)
            : null,
    };
  });

  const printedTotals =
    totalDeposit !== null
      ? {
          source: "printed",
          withdrawal: totalWithdrawal,
          deposit: totalDeposit,
          closingBalance,
        }
      : null;

  return {
    transactions: transactions.filter((row) => row.date),
    printedTotals,
  };
}

export { isSocietySavingsCompact, parseSocietySavingsCompact };
