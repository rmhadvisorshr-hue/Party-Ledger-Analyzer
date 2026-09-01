function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOcrDigits(text) {
  return text.replace(/(\d)[yY](\d)/g, "$1,$2");
}

function parseAmount(raw) {
  if (!raw) return null;
  const text = normalizeOcrDigits(clean(raw))
    .replace(/[CС]r|[CС]г|[CС]=/gi, "")
    .replace(/\s+/g, "");
  if (!/^-?[\d,]+\.?\d*/.test(text)) return null;
  const value = Number(text.replace(/,/g, "").replace(/Dr/gi, ""));
  if (!Number.isFinite(value)) return null;
  return Math.abs(value);
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

function parseSouthIndianDate(raw) {
  const match = clean(raw).match(/^(\d{2})-(\d{2})-(\d{2})\b/);
  if (!match) return null;
  return buildDate(match[1], match[2], match[3]);
}

function isSouthIndianBankLayout(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  return /SOUTH INDIAN BANK/i.test(text) && /WITHDRAWALS/i.test(text) && /DEPOSITS/i.test(text);
}

function isPureAmountLine(text) {
  const value = clean(text);
  return /^[\d,]+\.\d{2}:?\d{0,2}$/.test(value);
}

function isBalanceLine(text) {
  return /Cr|Cг|C=|Сг/i.test(text) && /[\d,]+\.?\d*/.test(text);
}

function parseBalanceFromLine(text) {
  const amounts = [...text.matchAll(/([\d,]+\.\d{2})/g)]
    .map((match) => parseAmount(match[1]))
    .filter((value) => value !== null);
  return amounts.length ? amounts[amounts.length - 1] : null;
}

function buildTransactionBlocks(texts) {
  const tableStart = texts.findIndex((text) => /^WITHDRAWALS$/i.test(text));
  const bodyStart = tableStart >= 0 ? tableStart + 1 : 0;

  const blocks = [];
  let current = null;

  for (let index = bodyStart; index < texts.length; index += 1) {
    const text = texts[index];
    if (/^DEPOSITS$/i.test(text) || /^BALANCE$/i.test(text)) continue;
    if (/Page Total|Grand Total|Disclaimer|https:\/\//i.test(text)) break;

    const inlineDate = text.match(/^(\d{2}-\d{2}-\d{2})\b/);
    if (inlineDate) {
      if (current) blocks.push(current);
      current = {
        date: parseSouthIndianDate(inlineDate[1]),
        lines: [text.replace(/^\d{2}-\d{2}-\d{2}\s*/, "")],
      };
      continue;
    }

    if (isPureAmountLine(text) || isBalanceLine(text)) continue;
    if (/^(DATE|PARTICULARS|CHQ|WITHDRAWALS|DEPOSITS|BALANCE)$/i.test(text)) continue;

    if (current) {
      current.lines.push(text);
    }
  }

  if (current) blocks.push(current);

  return blocks.filter((block) => block.date && !/^B\/[EF]$/i.test(clean(block.lines.join(" "))));
}

function collectAmountColumns(texts) {
  const withdrawals = [];
  const deposits = [];
  const balances = [];

  const firstAmount = texts.findIndex(
    (text, index) => index > 35 && (isPureAmountLine(text) || isBalanceLine(text)),
  );

  if (firstAmount < 0) {
    return { withdrawals, deposits, balances };
  }

  let phase = "withdrawals";

  for (let index = firstAmount; index < texts.length; index += 1) {
    const text = texts[index];
    if (/Page Total|Grand Total|Disclaimer|https:\/\//i.test(text)) break;

    if (/^DEPOSITS$/i.test(text)) {
      phase = "deposits";
      continue;
    }

    if (/^BALANCE$/i.test(text) && index > firstAmount + 2) {
      phase = "balances";
      continue;
    }

    if (phase === "balances" && isBalanceLine(text)) {
      const balance = parseBalanceFromLine(text);
      if (balance !== null) balances.push(balance);
      continue;
    }

    if (isPureAmountLine(text)) {
      const amount = parseAmount(text);
      if (amount === null) continue;
      if (phase === "deposits") deposits.push(amount);
      else withdrawals.push(amount);
    }
  }

  if (balances.length === 0) {
    for (let index = firstAmount; index < texts.length; index += 1) {
      const text = texts[index];
      if (/Page Total|Grand Total/i.test(text)) break;
      if (isBalanceLine(text)) {
        const balance = parseBalanceFromLine(text);
        if (balance !== null) balances.push(balance);
      }
    }
  }

  return { withdrawals, deposits, balances };
}

function extractPrintedTotalsSib(texts) {
  let withdrawal = null;
  let deposit = null;

  for (let index = 0; index < texts.length; index += 1) {
    const text = texts[index];
    const pageTotalLabel = `${text} ${texts[index + 1] || ""}`;
    if (/Page\s*Total/i.test(text) || /Page\s*Total/i.test(pageTotalLabel)) {
      const nextValues = [];
      for (let offset = 1; offset <= 6; offset += 1) {
        const value = parseAmount(texts[index + offset]);
        if (value !== null && value >= 10_000 && value < 10_000_000) {
          nextValues.push(value);
        }
      }
      const unique = [...new Set(nextValues)];
      if (unique.length >= 1) withdrawal = unique[0];
      if (unique.length >= 2) deposit = unique[1];
    }

    if (/Grand Total/i.test(text) && deposit === null) {
      for (let offset = 1; offset <= 4; offset += 1) {
        const value = parseAmount(texts[index + offset]);
        if (value !== null && value >= 10_000 && value < 10_000_000) {
          deposit = value;
          break;
        }
      }
    }
  }

  const closingBalances = texts
    .filter((text) => isBalanceLine(text))
    .map((text) => parseBalanceFromLine(text))
    .filter((value) => value !== null);

  const closingBalance = closingBalances[closingBalances.length - 1] ?? null;

  if (!withdrawal && !deposit && !closingBalance) return null;

  return {
    source: "printed",
    withdrawal,
    deposit,
    closingBalance,
  };
}

function assignAmountsToBlocks(blocks, withdrawals, deposits) {
  const transactions = [];
  let withdrawalIndex = 0;
  let depositIndex = 0;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const particulars = clean(block.lines.join(" "));

    let withdrawal = null;
    let deposit = null;

    const looksLikeCredit =
      /^(CIG|Transfer:|NEFT|PUNB|HDFC|Cash -|INST )/i.test(particulars) &&
      !/ATM Trn|Loan Account Payments/i.test(particulars);
    const looksLikeDebit = /ATM Trn|Loan Account Payments/i.test(particulars) || /\/CWD|\/CWDR/i.test(particulars);

    if (looksLikeDebit) {
      withdrawal = withdrawals[withdrawalIndex++] ?? null;
    } else if (looksLikeCredit) {
      deposit = deposits[depositIndex++] ?? null;
    } else if (deposits[depositIndex] !== undefined && withdrawals[withdrawalIndex] === undefined) {
      deposit = deposits[depositIndex++] ?? null;
    } else {
      withdrawal = withdrawals[withdrawalIndex++] ?? null;
      if (!withdrawal && deposits[depositIndex] !== undefined) {
        deposit = deposits[depositIndex++] ?? null;
      }
    }

    transactions.push({
      date: block.date,
      particulars: particulars || "TRANSACTION",
      chequeNo: null,
      withdrawal: withdrawal !== null ? roundMoney(withdrawal) : null,
      deposit: deposit !== null ? roundMoney(deposit) : null,
      balance: null,
    });
  }

  return transactions;
}

function buildTransactionsFromBalanceDeltas(blocks, balances) {
  if (blocks.length === 0 || balances.length < 2) return [];

  const transactions = [];
  let previous = balances[0];

  for (let index = 1; index < balances.length; index += 1) {
    const current = balances[index];
    const delta = roundMoney(current - previous);
    if (Math.abs(delta) < 0.01) continue;

    const block = blocks[Math.min(index - 1, blocks.length - 1)];

    transactions.push({
      date: block?.date || null,
      particulars: clean(block?.lines.join(" ") || "TRANSACTION"),
      chequeNo: null,
      withdrawal: delta < 0 ? roundMoney(Math.abs(delta)) : null,
      deposit: delta > 0 ? roundMoney(delta) : null,
      balance: roundMoney(current),
    });

    previous = current;
  }

  return transactions;
}

function parseSouthIndianBankStatement(lines) {
  const texts = lines.map((line) => clean(line.text || line));
  const blocks = buildTransactionBlocks(texts);
  const { withdrawals, deposits, balances } = collectAmountColumns(texts);

  let transactions = assignAmountsToBlocks(blocks, withdrawals, deposits);

  const assignedCredits = transactions.filter((row) => row.deposit).length;
  const creditBlocks = blocks.filter((block) =>
    /^(CIG|Transfer:|NEFT|INST )/i.test(clean(block.lines.join(" "))),
  ).length;

  const filledRows = transactions.filter((row) => row.withdrawal || row.deposit).length;
  if (balances.length >= 2 && (balances.length > filledRows || assignedCredits < creditBlocks)) {
    const deltaTxns = buildTransactionsFromBalanceDeltas(blocks, balances);
    if (deltaTxns.length > 0) transactions = deltaTxns;
  }

  for (let index = 0; index < transactions.length; index += 1) {
    if (balances[index] !== undefined && !transactions[index].balance) {
      transactions[index].balance = roundMoney(balances[index]);
    }
  }

  if (transactions.length > 0 && balances.length > 0) {
    transactions[transactions.length - 1].balance =
      transactions[transactions.length - 1].balance ?? roundMoney(balances[balances.length - 1]);
  }

  const printedTotals = extractPrintedTotalsSib(texts);

  return {
    transactions: transactions.filter((row) => row.date),
    printedTotals,
  };
}

export { isSouthIndianBankLayout, parseSouthIndianBankStatement };
