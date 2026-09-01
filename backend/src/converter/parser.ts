// @ts-nocheck
import {
  isColumnarOcrLayout,
  isSocietyCoopLayout,
  parseColumnarOcrStatement,
  parseSocietyCoopStatement,
} from "./ocrColumnarParser.js";
import { isSocietySavingsCompact, parseSocietySavingsCompact } from "./ocrSocietySavingsParser.js";
import { isSouthIndianBankLayout, parseSouthIndianBankStatement } from "./ocrSouthIndianParser.js";
import { isBankOfBarodaLayout, parseBankOfBarodaTransactions } from "./bobParser.js";
import { isDcbLayout, parseDcbOcrStatement } from "./dcbOcrParser.js";

function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanKey(value) {
  return clean(value).replace(/\s+/g, " ");
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
  const text = clean(raw).replace(/^'/, "");
  let match = text.match(/^(\d{2})[./-](\d{2})[./-](\d{2}|\d{4})$/);

  if (match) {
    return buildDate(match[1], match[2], match[3]);
  }

  match = text.match(/^(\d{2})[/-]([A-Za-z]{3,})[/-](\d{4})$/);
  if (match) {
    const month = monthNames[match[2].slice(0, 3).toLowerCase()];
    return month ? buildDate(match[1], month, match[3]) : null;
  }

  match = text.match(/^(\d{2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (match) {
    const month = monthNames[match[2].slice(0, 3).toLowerCase()];
    return month ? buildDate(match[1], month, match[3]) : null;
  }

  return null;
}

function findRowDate(line) {
  const text = clean(line);
  const patterns = [
    /^(?:\d+\s+)?'?(\d{2}[./-]\d{2}[./-]\d{2,4})\b/,
    /^(?:\d+\s+)?'?(\d{2}[/-][A-Za-z]{3,}[/-]\d{4})\b/,
    /^(?:\d+\s+)?(\d{2}\s+[A-Za-z]{3,}\s+\d{4})\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const date = parseDate(match[1]);
    if (!date) continue;

    return {
      date,
      raw: match[1],
      end: match[0].length,
    };
  }

  return null;
}

function isDateStart(line) {
  return Boolean(findRowDate(line));
}

function amountMatches(line, items = null) {
  const pattern = /-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{1,2}(?:\s*(?:Cr|Dr))?/gi;
  const itemPattern = /^-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{1,2}(?:\s*(?:Cr|Dr))?$/i;
  const itemAmounts = Array.isArray(items)
    ? items
        .map((item) => ({
          raw: clean(item.text),
          x: item.x,
          used: false,
        }))
        .filter((item) => itemPattern.test(item.raw))
    : [];

  return [...line.matchAll(pattern)]
    .filter((match) => {
      const before = line[match.index - 1] || "";
      const after = line[match.index + match[0].length] || "";
      return !/[.\d/-]/.test(before) && !/[.\d/-]/.test(after);
    })
    .map((match) => {
      const raw = clean(match[0]);
      const item = itemAmounts.find((candidate) => !candidate.used && candidate.raw === raw);
      if (item) item.used = true;

      return {
        raw: match[0],
        index: match.index,
        column: item ? item.x : match.index,
        value: parseAmount(match[0]),
      };
    });
}

function isTransactionHeader(line) {
  const text = clean(line);
  return (
    /^date\s+particulars/i.test(text) ||
    /^date\s+narration/i.test(text) ||
    /^#\s+date\s+description/i.test(text) ||
    /^sr\.?\s*no\.?\s+date\s+particulars/i.test(text) ||
    /^tran date\s+chq no\s+particulars/i.test(text) ||
    /^trans date\s+value date/i.test(text) ||
    /^transaction\s+withdrawal\s+deposit\s+balance/i.test(text) ||
    /^s no\.\s+cheque number transaction remarks/i.test(text) ||
    /^date\s+amount\s+\(inr\)/i.test(text) ||
    /^date\s+value date\s+particulars/i.test(text) ||
    /^tran date\s+chq no\s+particulars\s+debit\s+credit\s+balance/i.test(text) ||
    /^si\s+date\s+particulars\s+chq\s+num\s+withdrawal\s+deposit\s+balance/i.test(text)
  );
}

function isTerminalSummaryLine(line) {
  const text = clean(line);
  return (
    /^grand total\b/i.test(text) ||
    /^totals?\s*\/\s*balance/i.test(text) ||
    /^transaction total\b/i.test(text) ||
    /^statement summary\b/i.test(text) ||
    /^b\.\s+summary\b/i.test(text) ||
    /^account summary\b/i.test(text) ||
    /^end of statement\b/i.test(text) ||
    /^\*+\s*end of statement/i.test(text) ||
    /^\+{2,}\s*end of statement/i.test(text) ||
    /^closing balance\b/i.test(text)
    || /^total debits?\s*:/i.test(text)
    || /^summary\s*:\s*closing balance\s*:/i.test(text)
    || /^total credits?\s*:/i.test(text)
    || /^other account details\b/i.test(text)
    || /^sincerly,?$/i.test(text)
    || /^team icici bank$/i.test(text)
    || /^legends?\s/i.test(text)
  );
}

function isNoiseLine(line) {
  const text = clean(line);
  if (!text) return true;
  if (/^-{5,}$/.test(text)) return true;
  if (/^\*{5,}$/.test(text)) return true;
  if (/^\d+$/.test(text)) return true;
  if (/^\d+\s+of\s+\d+$/i.test(text)) return true;
  if (/^date\s+particulars/i.test(text)) return true;
  if (/^date\s+narration/i.test(text)) return true;
  if (/^si\s+date\s+particulars\s+chq\s+num\s+withdrawal\s+deposit\s+balance/i.test(text)) return true;
  if (/^s no\.\s+cheque number transaction remarks/i.test(text)) return true;
  if (/^date\s+amount\s+\(inr\)/i.test(text)) return true;
  if (/^page\s+(no|total|\d+)/i.test(text)) return true;
  if (/^grand total:/i.test(text)) return true;
  if (/^grand total\b/i.test(text)) return true;
  if (/^totals?\s*\/\s*balance/i.test(text)) return true;
  if (/^transaction total\b/i.test(text)) return true;
  if (/^closing balance\b/i.test(text)) return true;
  if (/^total debits?\s*:/i.test(text)) return true;
  if (/^summary\s*:\s*closing balance\s*:/i.test(text)) return true;
  if (/^total credits?\s*:/i.test(text)) return true;
  if (/^other account details\b/i.test(text)) return true;
  if (/^linked (casa accounts|deposits|loan & advances|lockers)\b/i.test(text)) return true;
  if (/^other digital products\b/i.test(text)) return true;
  if (/^no records found$/i.test(text)) return true;
  if (/^this is system generated statement/i.test(text)) return true;
  if (/^request to our customers/i.test(text)) return true;
  if (/^registered office:/i.test(text)) return true;
  if (/^disclaimer:/i.test(text)) return true;
  if (/^total number of transactions/i.test(text)) return true;
  if (/^turnover\b/i.test(text)) return true;
  if (/^all amounts are in/i.test(text)) return true;
  if (/^\*?\s*as on\b/i.test(text)) return true;
  if (/^clrbal:/i.test(text)) return true;
  if (/^transaction details page/i.test(text)) return true;
  if (/^note:/i.test(text)) return true;
  if (/^unless\s+/i.test(text)) return true;
  if (/^returning\s+/i.test(text)) return true;
  if (/^cheques received/i.test(text)) return true;
  if (/^we are committed/i.test(text)) return true;
  if (/^commitment to customers/i.test(text)) return true;
  if (/^for details please/i.test(text)) return true;
  if (/^within 15 days/i.test(text)) return true;
  if (/^transaction\(s\) in the statement/i.test(text)) return true;
  if (/^please contact/i.test(text)) return true;
  if (/^to get transaction alerts/i.test(text)) return true;
  if (/^abbreviations used/i.test(text)) return true;
  if (/^(retd|si|ec|cbi|sp|ecs|int|inchgs|obc|mb|daue|islixn)\s+-/i.test(text)) return true;
  if (/^pending penal charges/i.test(text)) return true;
  if (/^pending charges/i.test(text)) return true;
  if (/^recovered charges/i.test(text)) return true;
  if (/^nominee details/i.test(text)) return true;
  if (/^important information/i.test(text)) return true;
  if (/^for clarification kindly contact/i.test(text)) return true;
  if (/^non resident indian customers/i.test(text)) return true;
  if (/^\d+\.\s+/.test(text)) return true;
  if (/^this is a computer generated statement/i.test(text)) return true;
  if (/^\+{2,}\s*end of statement\s*\+{2,}$/i.test(text)) return true;
  if (/^\*{2,}\s*end of statement\s*\*{2,}$/i.test(text)) return true;
  if (/^sincerly,?$/i.test(text)) return true;
  if (/^team icici bank$/i.test(text)) return true;
  if (/^legends?\s/i.test(text)) return true;
  if (/^never share your otp/i.test(text)) return true;
  if (/^www\.icici/i.test(text)) return true;
  if (/^please call from/i.test(text)) return true;
  if (/^https?:\/\//i.test(text)) return true;
  if (/^bank of baroda\b/i.test(text)) return true;
  if (/^statement of accounts?/i.test(text)) return true;
  if (/^statement of transactions/i.test(text)) return true;
  if (/^statement summary\b/i.test(text)) return true;
  if (/^statement generated on/i.test(text)) return true;
  if (/^current account transactions/i.test(text)) return true;
  if (/^account statement\b/i.test(text)) return true;
  if (/^[A-Z][A-Z ]+\s+Time\s*:/i.test(text)) return true;
  if (/^hdfc bank limited$/i.test(text)) return true;
  if (/^dcb bank limited$/i.test(text)) return true;
  if (/^the federal bank ltd/i.test(text)) return true;
  if (/^registered office/i.test(text)) return true;
  if (/^contents of this statement/i.test(text)) return true;
  if (/^state account branch gstn/i.test(text)) return true;
  if (/^hdfc bank gstin/i.test(text)) return true;
  if (/^(address|branch|helpline no\.?|branch phone no\.?|micr code|ifsc code|gst registration|gst number|currentroi|limit|purpose code|total sanction|from date|phone #|run date|product|period|name currency)\b/i.test(text)) {
    return true;
  }
  if (/^(a\/c number|account no|account branch|account type|account status|a\/c open date|statement from|statement of account|rtgs\/neft ifsc|branch code|nomination|joint holders|cust id|email|phone no\.?|city|state|customer id|name|communication address|regd\. mobile number|type of account|scheme|swift code|effective available balance|date of issue|portfolio summary|account details|customer details|home branch details|mode of operation|account holder names|kyc complied|primary id type)\b/i.test(text)) {
    return true;
  }

  return false;
}

function looksGenericParticulars(value) {
  const text = clean(value);
  return (
    /^DIGITA-MUMBAI\/?$/i.test(text) ||
    /^EBANK:WIB\/\d+$/i.test(text) ||
    /^UPI\/\d+$/i.test(text) ||
    /^IMPS\/P2A\/\d+$/i.test(text) ||
    /^CHARGES FOR$/i.test(text)
  );
}

function classifyTransaction({ particulars, amount, balance, previousBalance }) {
  if (previousBalance !== null && previousBalance !== undefined) {
    const diff = roundMoney(balance - previousBalance);

    if (Math.abs(diff - amount) <= 0.02) return "deposit";
    if (Math.abs(diff + amount) <= 0.02) return "withdrawal";
  }

  const text = clean(particulars).toUpperCase();
  if (/\b(CR|CREDIT|DEPOSIT)\b/.test(text) || /RTGS CR|FT - CR/.test(text)) {
    return "deposit";
  }

  if (/\b(DR|DEBIT|WITHDRAWAL|CBDT)\b/.test(text) || /NEFT DR/.test(text)) {
    return "withdrawal";
  }

  return "deposit";
}

function splitNarrationAndReference(value) {
  const text = clean(value);
  const tokens = text.split(" ");
  if (tokens.length < 2) {
    return { particulars: text, chequeNo: null };
  }

  const last = tokens[tokens.length - 1];
  if (/^[A-Z0-9]{6,}$/i.test(last)) {
    return {
      particulars: clean(tokens.slice(0, -1).join(" ")),
      chequeNo: last,
    };
  }

  return { particulars: text, chequeNo: null };
}

function stripSecondDate(value) {
  const text = clean(value);
  const secondDate = findRowDate(text);
  return secondDate ? clean(text.slice(secondDate.end)) : text;
}

function normalizeNarration(value) {
  return clean(value)
    .replace(/^[-#]+\s*/, "")
    .replace(/\s+-\s*$/, "")
    .replace(/\s+/g, " ");
}

function parseTransactionLine(line, previousBalance, pendingNarration = "", amountColumns = null, items = null) {
  const rowDate = findRowDate(line);
  if (!rowDate) return null;

  const date = rowDate.date;
  const amounts = amountMatches(line, items);
  if (!date || amounts.length === 0) return null;

  const balanceMatch = amounts[amounts.length - 1];
  const balance = balanceMatch.value;

  if (amounts.length === 1) {
    return {
      date,
      particulars: normalizeNarration(pendingNarration) || "OPENING BALANCE",
      chequeNo: null,
      withdrawal: null,
      deposit: null,
      balance,
    };
  }

  const hasExplicitDebitCredit = amounts.length >= 3;
  const transactionAmountMatch = hasExplicitDebitCredit
    ? amounts[amounts.length - 3]
    : amounts[amounts.length - 2];
  const narrationStart = rowDate.end;
  const narrationEnd = transactionAmountMatch.index;
  let particulars = stripSecondDate(line.slice(narrationStart, narrationEnd));
  let chequeNo = null;

  if (pendingNarration) {
    particulars = clean(`${pendingNarration} ${particulars}`);
  }

  particulars = clean(particulars.replace(/\b\d{2}[/-]\d{2}[/-]\d{2,4}\s*$/, ""));

  const split = splitNarrationAndReference(particulars);
  particulars = normalizeNarration(split.particulars);
  chequeNo = split.chequeNo;

  let withdrawal = null;
  let deposit = null;

  if (amountColumns && (amountColumns.debit !== null || amountColumns.credit !== null)) {
    const balanceIndex = balanceMatch.index;
    const candidates = amounts.filter((match) => match.index !== balanceIndex);

    for (const match of candidates) {
      const column = match.column ?? match.index;
      const amount = Math.abs(match.value);

      if (
        amountColumns.coordinateBased &&
        amountColumns.debit !== null &&
        amountColumns.credit !== null &&
        amountColumns.debit < amountColumns.credit
      ) {
        if (column < amountColumns.credit) {
          withdrawal = amount;
        } else if (amountColumns.balance === null || column < amountColumns.balance) {
          deposit = amount;
        }
      } else {
        const distanceToDebit = amountColumns.debit === null ? Number.POSITIVE_INFINITY : Math.abs(column - amountColumns.debit);
        const distanceToCredit = amountColumns.credit === null ? Number.POSITIVE_INFINITY : Math.abs(column - amountColumns.credit);

        if (distanceToDebit < distanceToCredit) {
          withdrawal = amount;
        } else if (distanceToCredit < distanceToDebit) {
          deposit = amount;
        }
      }
    }
  }

  if (withdrawal === null && deposit === null) {
    if (hasExplicitDebitCredit) {
      const debit = Math.abs(amounts[amounts.length - 3].value);
      const credit = Math.abs(amounts[amounts.length - 2].value);
      withdrawal = debit > 0 ? debit : null;
      deposit = credit > 0 ? credit : null;
    } else {
      const amount = Math.abs(transactionAmountMatch.value);
      const type = classifyTransaction({
        particulars,
        amount,
        balance,
        previousBalance,
      });

      withdrawal = type === "withdrawal" ? amount : null;
      deposit = type === "deposit" ? amount : null;
    }
  }

  return {
    date,
    particulars: particulars || "TRANSACTION",
    chequeNo,
    withdrawal,
    deposit,
    balance,
  };
}

function appendContinuation(row, line) {
  const continuation = clean(line);
  if (!continuation || isNoiseLine(continuation)) return;

  if (looksGenericParticulars(row.particulars)) {
    row.particulars = continuation;
    return;
  }

  row.particulars = clean(`${row.particulars} ${continuation}`);
}

function parseOpeningBalance(line) {
  const text = clean(line);
  if (!/opening balance/i.test(text)) {
    if (/^-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{1,2}\s*(?:Cr|Dr)$/i.test(text)) {
      return parseAmount(text);
    }

    return null;
  }

  const amounts = amountMatches(text);
  if (amounts.length === 0) return null;

  return amounts[amounts.length - 1].value;
}

function extractOpeningBalance(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = clean(lines[index].text || lines[index]);
    if (!line) continue;

    if (/^opening balance\s+dr count\s+cr count\s+debits\s+credits\s+closing bal/i.test(line)) {
      const nextLine = clean(lines[index + 1]?.text || lines[index + 1]);
      const amounts = amountMatches(nextLine);
      if (amounts.length > 0) return amounts[0].value;
    }

    if (!/opening balance/i.test(line)) continue;

    const amounts = amountMatches(line);
    if (amounts.length === 0) continue;
    return amounts[amounts.length - 1].value;
  }

  return null;
}

function detectAmountColumnPositions(entry) {
  const line = entry?.text || entry;
  const items = entry?.items;

  if (Array.isArray(items) && items.length > 0) {
    const findItem = (pattern) => items.find((item) => pattern.test(clean(item.text)));

    const debitItem = findItem(/^(debit|withdrawal|dr)\b/i);
    const creditItem = findItem(/^(credit|deposit|cr)\b/i);
    const balanceItem = findItem(/^balance\b/i);

    if (debitItem || creditItem || balanceItem) {
      return {
        debit: debitItem ? debitItem.x : null,
        credit: creditItem ? creditItem.x : null,
        balance: balanceItem ? balanceItem.x : null,
        coordinateBased: true,
      };
    }
  }

  const text = clean(line).toLowerCase();
  const debitMatch = text.match(/\b(debit|withdrawal|dr)\b/);
  const creditMatch = text.match(/\b(credit|deposit|cr)\b/);
  const balanceMatch = text.match(/\bbalance\b/);

  return {
    debit: debitMatch ? text.indexOf(debitMatch[0]) : null,
    credit: creditMatch ? text.indexOf(creditMatch[0]) : null,
    balance: balanceMatch ? text.indexOf(balanceMatch[0]) : null,
    coordinateBased: false,
  };
}

function detectPrefixNarrationMode(lines) {
  const text = lines
    .slice(0, 80)
    .map((line) => clean(line.text || line))
    .join("\n");

  return /Tran Date Chq No Particulars Debit Credit Balance/i.test(text) ||
    /S No\.\s+Cheque Number Transaction Remarks/i.test(text) ||
    /Date Particulars Instruments Dr Amount Cr Amount Total Amount/i.test(text) ||
    /Sr No Date Particulars Debit Credit Balance/i.test(text);
}

function getNextMeaningfulLine(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = clean(lines[index].text || lines[index]);
    if (!line || isNoiseLine(line)) continue;
    return line;
  }

  return "";
}

function shouldAttachToCurrentInPrefixMode(line) {
  const text = clean(line);
  if (/^(UPI|IMPS|NEFT|RTGS|MMT|BIL|MOB|NFS|ATM|CLG|CHRG|EBA|FT|CBDT|BY CLG|SENTIMPS)\b[/: -]/i.test(text)) {
    return false;
  }

  return (
    /^\d{4}-/.test(text) ||
    /^[A-Z]{4}\d{7,}/i.test(text) ||
    /^(BANK|BRANCH|CELL|SERVICE|CHARGES?\.|GST|CLEARING|LTD\.?|PVT|PRIVATE|ACCOUNT)\b/i.test(text) ||
    /^\/?[A-Z0-9 ]{2,}\/[A-Z0-9]/i.test(text)
  );
}

function parseTransactions(lines) {
  const transactions = [];
  let current = null;
  let previousBalance = extractOpeningBalance(lines);
  let pendingNarration = [];
  const prefixNarrationMode = detectPrefixNarrationMode(lines);
  let started = !prefixNarrationMode;
  let amountColumns = null;

  for (let index = 0; index < lines.length; index += 1) {
    const entry = lines[index];
    const line = clean(entry.text || entry);
    if (!line) continue;

    if (isTransactionHeader(line)) {
      started = true;
      pendingNarration = [];
      amountColumns = detectAmountColumnPositions(entry);
      continue;
    }

    if (started && transactions.length > 0 && isTerminalSummaryLine(line)) {
      break;
    }

    const openingBalance = parseOpeningBalance(line);
    if (openingBalance !== null) {
      previousBalance = openingBalance;
      started = true;
      pendingNarration = [];
      continue;
    }

    if (!started && !isDateStart(line)) {
      continue;
    }

    if (isDateStart(line)) {
      started = true;
      const parsed = parseTransactionLine(
        line,
        previousBalance,
        clean(pendingNarration.join(" ")),
        amountColumns,
        entry.items
      );
      if (parsed) {
        transactions.push(parsed);
        current = parsed;
        previousBalance = parsed.balance;
        pendingNarration = [];
      }
      continue;
    }

    if (isNoiseLine(line)) {
      continue;
    }

    if (prefixNarrationMode) {
      const nextLine = getNextMeaningfulLine(lines, index + 1);
      if (nextLine && isDateStart(nextLine) && !shouldAttachToCurrentInPrefixMode(line)) {
        pendingNarration.push(line);
        continue;
      }

      if (current && pendingNarration.length === 0) {
        appendContinuation(current, line);
      } else {
        pendingNarration.push(line);
      }
      continue;
    }

    if (current) {
      appendContinuation(current, line);
    }
  }

  return transactions;
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return clean(match[1]);
  }

  return "";
}

function extractAccountInfo(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  const allLines = text.split("\n").map(clean).filter(Boolean);
  const info = [];

  const fields = [
    ["Bank", [/KOTAK MAHINDRA BANK/i, /IDFC FIRST BANK/i, /IDFC BANK/i, /IDFC/i, /BANK OF BARODA/i, /HDFC BANK/i, /UNION BANK OF INDIA/i, /IDBI BANK/i], (match) => {
      const value = match[0].toUpperCase();
      if (value.includes("KOTAK")) return "KOTAK MAHINDRA BANK";
      if (value.includes("IDFC")) return "IDFC FIRST BANK";
      if (value.includes("IDBI")) return "IDBI BANK";
      if (value.includes("HDFC")) return "HDFC BANK";
      if (value.includes("UNION")) return "UNION BANK OF INDIA";
      return "BANK OF BARODA";
    }],
    ["Branch", [/Account Branch\s*:\s*([^\n]+)/i, /^([A-Z ]+)\s+Time\s*:/im, /\bBranch\s+([^\n]+)/i]],
    ["IFSC Code", [/IFSC\s*(?:CODE)?\s*:\s*([A-Z0-9]+)/i, /RTGS\/NEFT IFSC\s*:\s*([A-Z0-9]+)/i, /IFSC\s*Code\s+([A-Z0-9]+)/i]],
    ["MICR Code", [/MICR\s*(?:CODE)?\s*:\s*([0-9]+)/i, /\bMICR\s+([0-9]+)/i]],
    ["Account Name", [
      /A\/C\s*Name\s*:\s*([^\n]+)/i,
      /Account\s*Name\s*:\s*([^\n]+)/i,
      /Account\s*Holder\s*Name\s*:\s*([^\n]+)/i,
      /Customer\s*Name\s*:\s*([^\n]+)/i,
      /Name\s*of\s*Account\s*Holder\s*:\s*([^\n]+)/i,
      /(?:^|\n)\s*(MR\.?\s+[A-Z][A-Z\s.]{4,60})\s*(?:\n|$)/im,
      /(?:^|\n)\s*(MRS\.?\s+[A-Z][A-Z\s.]{4,60})\s*(?:\n|$)/im,
      /(?:^|\n)\s*(MS\.?\s+[A-Z][A-Z\s.]{4,60})\s*(?:\n|$)/im,
      /\n(M\/S\.\s*[^\n]+)/i,
      /Account No\.\s+[0-9]+\s*\n([^\n]+)/i,
    ]],
    ["Account Number", [/A\/C\s*Number\s*:\s*([0-9]+)/i, /Account No\s*:\s*([0-9]+)/i, /Account No\.\s+([0-9]+)/i]],
    ["Account Type", [/Scheme Description\s*:\s*([^\n]+)/i, /Account Type\s*:\s*([^\n]+)/i, /Account Type\s+([A-Za-z]+)/i]],
    ["Account Open Date", [/Account Open Date\s*:\s*([0-9/-]+)/i, /A\/C Open Date\s*:\s*([0-9/-]+)/i]],
    ["Statement Period", [/period of\s*([0-9/-]+\s*to\s*[0-9/-]+)/i, /Statement From\s*:\s*([0-9/-]+\s*To\s*[0-9/-]+)/i]],
    ["Address", [/Address\s*:\s*([^\n]+)/i]],
    ["City", [/City\s*:\s*([^\n]+)/i]],
    ["Customer ID", [/Cust ID\s*:\s*([0-9]+)/i]],
    ["Account Status", [/Account Status\s+([A-Za-z]+)/i]],
    ["Nominee", [/Nominee Name\s*:\s*([^\n]+)/i, /Nomination\s*:\s*([^\n]+)/i, /Nominee Registered\s+([A-Za-z]+)/i]],
    ["Joint Holders", [/Joint Holders\s*:\s*([^\n]+)/i]],
  ];

  for (const field of fields) {
    const [label, patterns, mapper] = field;
    let value = "";

    if (mapper) {
      const match = patterns.map((pattern) => text.match(pattern)).find(Boolean);
      value = match ? mapper(match) : "";
    } else {
      value = firstMatch(text, patterns);
    }

    if (value) {
      info.push({ label: cleanKey(label), value });
    }
  }

  for (const line of allLines) {
    if (/^https?$/i.test(line.split(":")[0] || "")) continue;
    const match = line.match(/^([A-Za-z][A-Za-z ./&-]{2,30})\s*:\s*(.+)$/);
    if (!match) continue;

    const label = cleanKey(match[1]);
    const value = clean(match[2]);
    if (!value) continue;
    if (/^\/\//.test(value)) continue;
    if (info.some((entry) => entry.label.toLowerCase() === label.toLowerCase())) continue;
    if (/^(date|time|page no|helpline no|branch phone no)$/i.test(label)) continue;

    info.push({ label, value });
  }

  for (let index = info.length - 1; index >= 0; index -= 1) {
    const entry = info[index];
    if (!/account name/i.test(entry.label)) continue;
    const value = entry.value || "";
    if (
      /^address\b/i.test(value) ||
      (/\b(HDFC|ICICI|AXIS|SBI)\s+BANK\b/i.test(value) && !/\b(MR|MRS|MS|M\/S)\b/i.test(value))
    ) {
      info.splice(index, 1);
    }
  }

  const hasAccountName = info.some((entry) => /account name/i.test(entry.label));
  if (!hasAccountName) {
    const fallbackName = allLines.slice(0, 60).find((line) =>
      /\b(pvt\.?\s*ltd|private\s+limited|ltd\.?|llp|inc\.?|corporation|company|co\.)\b/i.test(line) &&
      !/\b(bank|registered office|notice|disclaimer|discrepancy)\b/i.test(line)
    );

    if (fallbackName) {
      info.push({ label: "Account Name", value: fallbackName });
    }
  }

  return info;
}

function extractPrintedTotals(lines) {
  let closingBalance = null;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = clean(lines[index].text || lines[index]);
    if (/^total debits?\s*:/i.test(line)) {
      const debitAmounts = amountMatches(line);
      let credit = null;
      let closing = null;

      for (let lookahead = index + 1; lookahead < Math.min(lines.length, index + 8); lookahead += 1) {
        const nextLine = clean(lines[lookahead].text || lines[lookahead]);
        const amounts = amountMatches(nextLine);

        if (/^total credits?\s*:/i.test(nextLine) && amounts.length > 0) {
          credit = amounts[0].value;
        }

        if (/^summary\s*:\s*closing balance\s*:/i.test(nextLine) && amounts.length > 0) {
          closing = amounts[0].value;
        }
      }

      if (debitAmounts.length > 0 && credit !== null) {
        return {
          source: "printed",
          withdrawal: Math.abs(debitAmounts[0].value),
          deposit: Math.abs(credit),
          closingBalance: closing,
        };
      }
    }

    if (/^opening balance\s+dr count\s+cr count\s+debits\s+credits\s+closing bal/i.test(line)) {
      const nextLine = clean(lines[index + 1]?.text || lines[index + 1]);
      const amounts = amountMatches(nextLine);

      if (amounts.length >= 4) {
        return {
          source: "printed",
          withdrawal: Math.abs(amounts[1].value),
          deposit: Math.abs(amounts[2].value),
          closingBalance: amounts[3].value,
        };
      }
    }

    if (closingBalance === null && /^closing balance\b/i.test(line)) {
      const amounts = amountMatches(line);
      if (amounts.length > 0) {
        closingBalance = amounts[amounts.length - 1].value;
      }
    }

    const isTotalLine =
      /^grand total\b/i.test(line) ||
      /^totals?\s*\/\s*balance/i.test(line) ||
      /^transaction total\b/i.test(line) ||
      /^turnover\b/i.test(line);

    if (!isTotalLine) continue;

    const amounts = amountMatches(line);
    if (amounts.length < 2) return null;

    return {
      source: "printed",
      withdrawal: Math.abs(amounts[0].value),
      deposit: Math.abs(amounts[1].value),
      closingBalance: amounts.length >= 3 ? amounts[2].value : closingBalance,
    };
  }

  return null;
}

function calculateTotals(transactions) {
  const totals = transactions.reduce(
    (result, transaction) => {
      result.withdrawal += Number(transaction.withdrawal || 0);
      result.deposit += Number(transaction.deposit || 0);
      result.closingBalance = transaction.balance;
      return result;
    },
    { withdrawal: 0, deposit: 0, closingBalance: null }
  );

  return {
    source: "calculated",
    withdrawal: roundMoney(totals.withdrawal),
    deposit: roundMoney(totals.deposit),
    closingBalance:
      totals.closingBalance === null ? null : roundMoney(totals.closingBalance),
  };
}

function parseStatement(extraction) {
  const lines = extraction.lines || [];
  const accountInfo = extractAccountInfo(lines);
  let transactions = isBankOfBarodaLayout(lines)
    ? parseBankOfBarodaTransactions(lines)
    : parseTransactions(lines);
  let printedTotals = extractPrintedTotals(lines);

  if (transactions.length === 0 && isSocietySavingsCompact(lines)) {
    const savings = parseSocietySavingsCompact(lines);
    transactions = savings.transactions;
    if (savings.printedTotals) printedTotals = savings.printedTotals;
  } else if (transactions.length === 0 && isSouthIndianBankLayout(lines)) {
    const sib = parseSouthIndianBankStatement(lines);
    transactions = sib.transactions;
    if (sib.printedTotals) printedTotals = sib.printedTotals;
  } else if (transactions.length === 0 && isSocietyCoopLayout(lines)) {
    const society = parseSocietyCoopStatement(lines);
    transactions = society.transactions;
    if (society.printedTotals) printedTotals = society.printedTotals;
  } else if (transactions.length === 0 && isColumnarOcrLayout(lines)) {
    const columnar = parseColumnarOcrStatement(lines);
    transactions = columnar.transactions;
    if (columnar.printedTotals) printedTotals = columnar.printedTotals;
  }

  // DCB's scanned-statement OCR text routinely gets a *few* rows right via
  // the generic row-per-line engine above (whichever ones happened to land
  // on a single clean OCR line) while silently dropping every row whose
  // date and amount were split across lines by Tesseract -- so this can't
  // gate on `transactions.length === 0` like the fallbacks above. It's
  // gated on the bank being detected at all (never touches other banks)
  // and only takes over when it actually recovers more balance-verified
  // rows than the generic pass did.
  if (isDcbLayout(lines)) {
    const dcb = parseDcbOcrStatement(lines, extractOpeningBalance(lines));
    if (dcb.transactions.length > transactions.length) {
      transactions = dcb.transactions;
    }
  }

  const calculatedTotals = calculateTotals(transactions);
  const totals =
    printedTotals &&
    printedTotals.withdrawal !== null &&
    printedTotals.deposit !== null
      ? {
          source: "printed",
          withdrawal: printedTotals.withdrawal,
          deposit: printedTotals.deposit,
          closingBalance: printedTotals.closingBalance,
        }
      : calculatedTotals;

  return {
    accountInfo,
    transactions,
    totals,
    printedTotals: printedTotals || null,
    pageCount: extraction.pageCount,
  };
}

export { parseStatement, parseTransactions, extractAccountInfo };
