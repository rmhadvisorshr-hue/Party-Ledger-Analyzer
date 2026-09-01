import ExcelJS from "exceljs";

const manualPath = "D:/Data/test data/NAMDAR CORNER-all/HDFC BANK 88031 OD.xls";
const aiPath = "c:/Users/HP/Downloads/MS. NAMDAR CORNER_Bank of Baroda_8031_Transaction_Summary.xlsx";

function fmtDate(v) {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s.slice(0, 10);
}

function num(v) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normalizeName(name) {
  return String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseManualLedger(rows) {
  const parties = new Map();

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map((v) => (v instanceof Date ? v : String(v ?? "").trim()));
    const date = cells[0];
    const drCr = cells[1];
    const party = cells[2];
    const vchType = cells[5];
    const debitAmt = num(cells[7]);
    const creditAmt = num(cells[8]);

    if (!(date instanceof Date) && !/^\d{4}/.test(String(date))) continue;
    if (!party || party === "Particulars" || party === "Opening Balance") continue;

    const dateStr = fmtDate(date);
    const amount = debitAmt > 0 ? debitAmt : creditAmt;
    if (amount <= 0) continue;

    const isPayment = vchType === "Payment" || drCr === "Dr";
    const isReceipt = vchType === "Receipt" || vchType === "Contra" && drCr === "Cr";

    // Bank book: Payment/Dr outbound -> credit column; Receipt/Contra deposit -> debit column
    const direction =
      vchType === "Payment" || (drCr === "Dr" && creditAmt > 0)
        ? "Debit"
        : vchType === "Receipt" || (drCr === "Cr" && debitAmt > 0)
          ? "Credit"
          : drCr === "Dr"
            ? "Debit"
            : "Credit";

    // Narration from next row(s)
    let narration = "";
    for (let j = i + 1; j < Math.min(i + 4, rows.length); j++) {
      const next = rows[j].map((v) => String(v ?? "").trim());
      if (next[0] && /^\d{4}/.test(next[0])) break;
      if (next[2] && !next[5]) narration = next[2] || narration;
    }

    const key = normalizeName(party);
    if (!parties.has(key)) {
      parties.set(key, { display: party, debits: [], credits: [] });
    }
    const entry = { date: dateStr, party, vchType, direction, amount, narration, drCr };

    if (direction === "Debit") parties.get(key).debits.push(entry);
    else parties.get(key).credits.push(entry);
  }

  return parties;
}

function parseAiSummary(rows) {
  const parties = new Map();
  let current = null;

  for (const vals of rows) {
    const cells = vals.map((v) => String(v ?? "").trim());
    const txnCount = Number(cells[3]?.replace(/,/g, ""));

    if (
      cells[0] &&
      cells[0] !== "Counterparty" &&
      !cells[0].includes("M/S.") &&
      !cells[0].includes("Account Number") &&
      Number.isFinite(txnCount) &&
      txnCount > 0 &&
      cells[1] &&
      cells[1] !== "Party Name"
    ) {
      current = normalizeName(cells[0]);
      parties.set(current, {
        display: cells[0],
        txnCount,
        debitTotal: num(cells[4]),
        creditTotal: num(cells[5]),
        debits: [],
        credits: [],
      });
      continue;
    }

    if (current && /^\d{4}-\d{2}-\d{2}$/.test(cells[2])) {
      const d = num(cells[6]);
      const c = num(cells[7]);
      const entry = {
        date: cells[2],
        type: cells[3],
        mode: cells[4],
        debit: d,
        credit: c,
        narration: cells[8],
      };
      if (d > 0) parties.get(current).debits.push(entry);
      if (c > 0) parties.get(current).credits.push(entry);
    }
  }

  return parties;
}

function fuzzyMatch(manualKey, aiParties) {
  for (const [aiKey, aiData] of aiParties) {
    if (manualKey.includes(aiKey.slice(0, 10)) || aiKey.includes(manualKey.slice(0, 10))) {
      return { aiKey, aiData };
    }
    const manualTokens = manualKey.split(" ").filter((t) => t.length > 3);
    const aiTokens = aiKey.split(" ").filter((t) => t.length > 3);
    const overlap = manualTokens.filter((t) => aiTokens.some((a) => a.includes(t) || t.includes(a)));
    if (overlap.length >= 2) return { aiKey, aiData };
  }
  return null;
}

async function load(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const rows = [];
  wb.worksheets[0].eachRow((row) => rows.push(row.values.slice(1)));
  return rows;
}

const manualRows = await load(manualPath);
const aiRows = await load(aiPath);

const manual = parseManualLedger(manualRows);
const ai = parseAiSummary(aiRows);

const manualDebitParties = [...manual.entries()]
  .map(([k, v]) => ({ key: k, ...v, debitCount: v.debits.length }))
  .filter((p) => p.debitCount > 0)
  .sort((a, b) => b.debitCount - a.debitCount);

console.log(`Manual parties with debits: ${manualDebitParties.length}`);
console.log(`AI parties with debits: ${[...ai.values()].filter((p) => p.debits.length > 0).length}`);

const manualFour = manualDebitParties.filter((p) => p.debitCount === 4);
console.log(`\nManual parties with exactly 4 debits: ${manualFour.length}`);
manualFour.forEach((p) => {
  console.log(`\nMANUAL: ${p.display} (${p.debitCount} debits)`);
  p.debits.forEach((d, i) =>
    console.log(`  ${i + 1}. ${d.date} | ${d.vchType} | ${d.amount} | ${d.narration || d.party}`),
  );
  const match = fuzzyMatch(p.key, ai);
  if (!match) {
    console.log("  AI MATCH: none");
    return;
  }
  console.log(`  AI MATCH: ${match.aiData.display} (${match.aiData.debits.length} debits)`);
  match.aiData.debits.forEach((d, i) =>
    console.log(`  AI ${i + 1}. ${d.date} | ${d.mode} | ${d.debit} | ${String(d.narration).slice(0, 60)}`),
  );
});

// Compare Samseena as example from manual row 18
console.log("\n--- SAMSEENA comparison ---");
const samManual = [...manual.entries()].find(([k]) => k.includes("SAMSEENA"));
const samAi = [...ai.entries()].find(([k]) => k.includes("SAMSEENA"));
if (samManual) {
  console.log("Manual:", samManual[1].display, "debits:", samManual[1].debits.length);
  samManual[1].debits.forEach((d) => console.log(" ", d.date, d.amount, d.narration));
}
if (samAi) {
  console.log("AI:", samAi[1].display, "debits:", samAi[1].debits.length);
  samAi[1].debits.forEach((d) => console.log(" ", d.date, d.debit, d.mode, String(d.narration).slice(0, 50)));
}

// HDFC Bank Insurance - 4 payments in manual rows 43-51
console.log("\n--- HDFC Bank Insurance (4 manual payments) ---");
const insManual = [...manual.entries()].find(([k]) => k.includes("HDFC BANK INSURANCE"));
const insAi = [...ai.entries()].filter(([k]) => k.includes("INSUR") || k.includes("BAJAJ") || k.includes("PROP"));
console.log("Manual:", insManual?.[1]?.debits?.length, "debits");
insManual?.[1]?.debits?.forEach((d) => console.log(" ", d.date, d.amount));
console.log("AI matches:", insAi.map(([k, v]) => `${v.display} (${v.debits.length})`).join("; "));
