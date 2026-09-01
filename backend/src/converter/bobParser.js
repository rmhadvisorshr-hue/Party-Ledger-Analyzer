function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(raw) {
  if (!raw) return null;

  const text = clean(raw);
  const value = Number(text.replace(/,/g, "").replace(/Cr|Dr/gi, ""));
  if (!Number.isFinite(value)) return null;

  return /^-/.test(text) || /Dr$/i.test(text) ? -Math.abs(value) : value;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

const AMOUNT_PATTERN = /^-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{1,2}(?:\s*(?:Cr|Dr))?$/i;

function isAmountText(text) {
  return AMOUNT_PATTERN.test(clean(text));
}

function parseDate(raw) {
  const text = clean(raw).replace(/^'/, "");
  const match = text.match(/^(\d{2})[./-](\d{2})[./-](\d{2}|\d{4})$/);
  if (!match) return null;

  let year = Number(match[3]);
  if (year < 100) year += year <= 69 ? 2000 : 1900;

  return new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
}

function isBankOfBarodaLayout(lines) {
  const text = lines
    .slice(0, 40)
    .map((line) => clean(line.text || line))
    .join("\n");

  return (
    /TRAN DATE\s+VALUE DATE\s+NARRATION/i.test(text) &&
    /WITHDRAWAL\(DR\)\s+DEPOSIT\(CR\)\s+BALANCE/i.test(text)
  );
}

function detectBobAmountColumns(lines) {
  for (const entry of lines.slice(0, 40)) {
    const text = clean(entry.text || entry);
    if (!/TRAN DATE\s+VALUE DATE\s+NARRATION/i.test(text)) continue;

    const items = entry.items || [];
    const findX = (pattern) => {
      const item = items.find((candidate) => pattern.test(clean(candidate.text)));
      return item ? item.x : null;
    };

    return {
      withdrawal: findX(/^WITHDRAWAL\(DR\)$/i),
      deposit: findX(/^DEPOSIT\(CR\)$/i),
      balance: findX(/^BALANCE\(INR\)$/i),
    };
  }

  return { withdrawal: null, deposit: null, balance: null };
}

function extractAmountItems(items = []) {
  return items
    .map((item) => ({
      x: item.x,
      text: clean(item.text),
      value: Math.abs(parseAmount(item.text)),
      isCreditBalance: /Cr$/i.test(clean(item.text)),
    }))
    .filter((item) => isAmountText(item.text) && item.value !== null);
}

function extractNarrationFromItems(items = [], amountColumns) {
  const narrationStart = 150;
  const narrationEnd = (amountColumns.withdrawal || 430) - 10;

  return clean(
    items
      .filter((item) => {
        const text = clean(item.text);
        if (isAmountText(text)) return false;
        if (/^\d{2}[./-]\d{2}[./-]\d{2,4}$/.test(text)) return false;
        return item.x >= narrationStart && item.x <= narrationEnd;
      })
      .sort((a, b) => a.x - b.x)
      .map((item) => item.text)
      .join(" "),
  );
}

function nearestColumn(x, amountColumns) {
  const columns = [
    ["withdrawal", amountColumns.withdrawal],
    ["deposit", amountColumns.deposit],
    ["balance", amountColumns.balance],
  ].filter(([, position]) => position !== null);

  columns.sort((left, right) => Math.abs(x - left[1]) - Math.abs(x - right[1]));
  return columns[0]?.[0] || "balance";
}

function resolveBalanceFromItems(amountItems, amountColumns) {
  if (amountItems.length === 0) return null;

  const creditBalanceItem = [...amountItems].reverse().find((item) => item.isCreditBalance);
  if (creditBalanceItem) return creditBalanceItem.value;

  const balanceItem = [...amountItems].sort(
    (left, right) =>
      Math.abs(left.x - amountColumns.balance) - Math.abs(right.x - amountColumns.balance),
  )[0];

  if (balanceItem) return balanceItem.value;

  return Math.max(...amountItems.map((item) => item.value));
}

function assignBobAmounts(amountItems, amountColumns) {
  if (amountItems.length === 0) {
    return { withdrawal: null, deposit: null, balance: null, transactionAmount: null };
  }

  if (amountItems.length === 1) {
    const item = amountItems[0];
    const column = nearestColumn(item.x, amountColumns);

    if (item.isCreditBalance) {
      return {
        withdrawal: null,
        deposit: null,
        balance: item.value,
        transactionAmount: null,
        transactionColumn: null,
      };
    }

    if (column === "balance") {
      return { withdrawal: null, deposit: null, balance: item.value, transactionAmount: null };
    }

    if (column === "withdrawal") {
      return {
        withdrawal: item.value,
        deposit: null,
        balance: null,
        transactionAmount: item.value,
        transactionColumn: "withdrawal",
      };
    }

    return {
      withdrawal: null,
      deposit: item.value,
      balance: null,
      transactionAmount: item.value,
      transactionColumn: "deposit",
    };
  }

  let withdrawal = null;
  let deposit = null;
  let balance = resolveBalanceFromItems(amountItems, amountColumns);
  const balanceItem =
    [...amountItems].reverse().find((item) => item.isCreditBalance) ||
    [...amountItems].sort(
      (left, right) =>
        Math.abs(left.x - amountColumns.balance) - Math.abs(right.x - amountColumns.balance),
    )[0];
  const transactionItem = amountItems.find((item) => item !== balanceItem);
  const transactionColumn = transactionItem ? nearestColumn(transactionItem.x, amountColumns) : null;

  if (transactionItem && transactionColumn === "withdrawal") {
    withdrawal = transactionItem.value;
  } else if (transactionItem) {
    deposit = transactionItem.value;
  }

  return {
    withdrawal,
    deposit,
    balance,
    transactionAmount: transactionItem ? transactionItem.value : null,
    transactionColumn,
  };
}

function classifyByBalanceDelta(transactions) {
  for (let index = 0; index < transactions.length; index += 1) {
    const row = transactions[index];
    const older = transactions[index + 1];
    if (!older || row.balance === null || older.balance === null) {
      if (row.transactionAmount !== null && row.transactionAmount !== undefined) {
        if (row.transactionColumn === "withdrawal") {
          row.withdrawal = row.transactionAmount;
          row.deposit = null;
        } else {
          row.withdrawal = null;
          row.deposit = row.transactionAmount;
        }
      }
      continue;
    }

    const delta = roundMoney(row.balance - older.balance);
    if (Math.abs(delta) < 0.02) {
      row.withdrawal = null;
      row.deposit = null;
      continue;
    }

    if (delta > 0) {
      row.deposit = Math.abs(delta);
      row.withdrawal = null;
    } else {
      row.withdrawal = Math.abs(delta);
      row.deposit = null;
    }
  }

  return transactions;
}

function cleanBobNarration(text) {
  return clean(text)
    .replace(/\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\b.*$/i, "")
    .replace(/\s*contact-us@\d+.*$/i, "")
    .replace(/\s*page\s+\d+\s+of\s+\d+.*$/i, "")
    .trim();
}

function isBobNoiseLine(text) {
  return (
    !text ||
    /^page\s+\d+\s+of\s+\d+/i.test(text) ||
    /page\s+\d+\s+of\s+\d+/i.test(text) ||
    /^\*?this is computer-generated statement/i.test(text) ||
    /^contact-us@/i.test(text) ||
    /contact-us@\d+/i.test(text) ||
    /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\b/i.test(text) ||
    /^--\s*\d+\s+of\s+\d+\s*--$/i.test(text) ||
    /^customer id:/i.test(text) ||
    /^branch name:/i.test(text) ||
    /^ifsc code:/i.test(text) ||
    /^your account statement/i.test(text) ||
    /^statement of transactions/i.test(text) ||
    /^main account holder name/i.test(text) ||
    /^authorised signatory/i.test(text) ||
    /^tran date\s+value date\s+narration/i.test(text) ||
    /^jigeesha auto service account/i.test(text) ||
    /^address\s*:/i.test(text) ||
    /^nominee reg:/i.test(text) ||
    /^micr code:/i.test(text) ||
    /^account no:/i.test(text) ||
    /^statement period from/i.test(text) ||
    /^[A-Z]\*[A-Z0-9* ]+$/i.test(text)
  );
}

function isOrphanAmountLine(entry) {
  const text = clean(entry.text || entry);
  const amountItems = extractAmountItems(entry.items || []);
  return amountItems.length === 1 && text === amountItems[0].text;
}

function applyOrphanAmount(current, amountItem, amountColumns) {
  current.transactionAmount = amountItem.value;
  current.transactionColumn = nearestColumn(amountItem.x, amountColumns);
}

function parseBankOfBarodaTransactions(lines) {
  const amountColumns = detectBobAmountColumns(lines);
  const transactions = [];
  let current = null;

  for (let index = 0; index < lines.length; index += 1) {
    const entry = lines[index];
    const text = clean(entry.text || entry);
    if (!text || isBobNoiseLine(text)) continue;

    if (isOrphanAmountLine(entry)) {
      const amountItems = extractAmountItems(entry.items || []);
      if (current) {
        applyOrphanAmount(current, amountItems[0], amountColumns);
      }
      continue;
    }

    const items = entry.items || [];
    const dateItem = items.find((item) => /^\d{2}[./-]\d{2}[./-]\d{2,4}$/.test(clean(item.text)));
    const date = dateItem ? parseDate(dateItem.text) : null;
    if (!date) {
      if (current && !isAmountText(text) && !isBobNoiseLine(text)) {
        current.particulars = clean(`${current.particulars} ${text}`);
      }
      continue;
    }

    const amountItems = extractAmountItems(items);
    if (amountItems.length === 0) continue;

    const assigned = assignBobAmounts(amountItems, amountColumns);
    const narration = extractNarrationFromItems(items, amountColumns);

    const row = {
      date,
      particulars: narration || "TRANSACTION",
      chequeNo: null,
      withdrawal: assigned.withdrawal,
      deposit: assigned.deposit,
      balance: assigned.balance,
      transactionAmount: assigned.transactionAmount,
      transactionColumn: assigned.transactionColumn,
    };

    transactions.push(row);
    current = row;
  }

  const classified = classifyByBalanceDelta(transactions);
  for (const row of classified) {
    row.particulars = cleanBobNarration(row.particulars) || "TRANSACTION";
    delete row.transactionAmount;
    delete row.transactionColumn;
  }

  return classified;
}

export { isBankOfBarodaLayout, parseBankOfBarodaTransactions };
