import fs from "node:fs";
import path from "node:path";
import type { NormalizedTransaction } from "./types";

type GroqPartyResolution = {
  txnId: string;
  normalizedParty: string;
  counterPartyLedger?: string;
  confidence?: number;
};

type GroqResponseRow = {
  txnId?: unknown;
  normalizedParty?: unknown;
  normalized_party_name?: unknown;
  party_name?: unknown;
  party_type?: unknown;
  transaction_mode?: unknown;
  category?: unknown;
  aliases?: unknown;
  party?: unknown;
  counterPartyLedger?: unknown;
  ledger?: unknown;
  confidence?: unknown;
};

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.1-8b-instant";
const MAX_BATCH_SIZE = 60;
const MAX_BATCH_PAYLOAD_CHARS = 45_000;

function readEnvFile(): Record<string, string> {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", ".env"),
    path.resolve(process.cwd(), "..", "..", ".env"),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const values: Record<string, string> = {};
    const raw = fs.readFileSync(filePath, "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const eq = trimmed.indexOf("=");
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key) values[key] = value;
    });
    return values;
  }

  return {};
}

function getGroqConfig() {
  const envFile = readEnvFile();
  return {
    enabled: (process.env.GROQ_PARTY_RESOLUTION || envFile.GROQ_PARTY_RESOLUTION || "enabled") !== "disabled",
    apiKey: process.env.GROQ_API_KEY || envFile.GROQ_API_KEY || "",
    model: process.env.GROQ_MODEL || envFile.GROQ_MODEL || DEFAULT_MODEL,
  };
}

function compactRows(transactions: NormalizedTransaction[]) {
  return transactions.map((txn) => ({
    txnId: txn.id,
    date: txn.dateText,
    direction: txn.direction,
    debit: txn.debit,
    credit: txn.credit,
    mode: txn.mode,
    party: txn.party,
    narration: txn.narration,
  }));
}

function chunkRowsByPayload<T>(items: T[], maxRows: number, maxChars: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentChars = 2;

  for (const item of items) {
    const itemChars = JSON.stringify(item).length + 1;
    const wouldExceedRows = current.length >= maxRows;
    const wouldExceedChars = current.length > 0 && currentChars + itemChars > maxChars;

    if (wouldExceedRows || wouldExceedChars) {
      chunks.push(current);
      current = [];
      currentChars = 2;
    }

    current.push(item);
    currentChars += itemChars;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

function normalizeName(value: unknown): string {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s.&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLedger(value: unknown): string {
  const text = String(value || "").trim();
  return text.replace(/\s+/g, " ") || "Others";
}

function confidenceValue(value: unknown): number {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return 75;
  return Math.max(0, Math.min(100, Math.round(confidence)));
}

function extractJsonObject(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(content.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function validateRows(payload: unknown, allowedIds: Set<string>): GroqPartyResolution[] {
  const rows = Array.isArray((payload as { rows?: unknown })?.rows)
    ? ((payload as { rows: unknown[] }).rows as GroqResponseRow[])
    : Array.isArray((payload as { transactions?: unknown })?.transactions)
      ? ((payload as { transactions: unknown[] }).transactions as GroqResponseRow[])
      : [];

  const validated: GroqPartyResolution[] = [];
  rows.forEach((row) => {
    const txnId = String(row.txnId || "");
    if (!allowedIds.has(txnId)) return;

    const normalizedParty = normalizeName(
      row.normalizedParty || row.normalized_party_name || row.party_name || row.party,
    );
    if (!normalizedParty || normalizedParty === "UNRECOGNIZED") return;

    validated.push({
      txnId,
      normalizedParty,
      counterPartyLedger: normalizeLedger(
        row.counterPartyLedger || row.ledger || row.category || row.party_type,
      ),
      confidence: confidenceValue(row.confidence),
    });
  });

  return validated;
}

async function resolveBatch(
  rows: ReturnType<typeof compactRows>,
  config: { apiKey: string; model: string },
): Promise<GroqPartyResolution[]> {
  const allowedIds = new Set(rows.map((row) => row.txnId));
  const response = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You are a forensic banking transaction intelligence engine.",
            "Your job is to identify the REAL counterparty/entity involved in each transaction and normalize all variants into one canonical party.",
            "The objective is PARTY CONSOLIDATION, not narration extraction, keyword extraction, location extraction, or payment-mode extraction.",
            "The final Party Summary in browser and Excel groups by normalized_party_name only.",
            "Never use locations, cities, states, branch names, IFSC codes, bank names, transaction references, UTR numbers, mandate IDs, OCR fragments, payment modes, or generic categories as party names.",
            "Return only strict JSON. Do not include markdown or explanations.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            instructions: [
              "For every input row, return one output row.",
              "Output shape: { rows: [{ txnId, party_name, normalized_party_name, party_type, transaction_mode, category, aliases, confidence }] }.",
              "txnId must exactly match the input txnId.",
              "normalized_party_name must be the true consolidated counterparty/entity name only.",
              "party_name can be the best raw party label found, but normalized_party_name must be canonical and used for grouping.",
              "party_type must be one of PERSON, BUSINESS, MERCHANT, SUBSCRIPTION, BANK CHARGES, TAX PAYMENT, SALARY, UTILITY, BANK EVENT, OTHERS.",
              "transaction_mode must identify the payment mode separately: UPI, IMPS, NEFT, RTGS, CHEQUE, CARD, ACH, SI, AUTOPAY, CASH, TRANSFER, SWEEP, INTEREST, BANK CHARGES, OTHER.",
              "category should be the accounting category, such as SALARY, TAX PAYMENT, BANK CHARGES, UTILITY, MERCHANT, SUBSCRIPTION, TRADE PARTY, CASH, OTHERS.",
              "aliases must include important raw/OCR variants that should merge into normalized_party_name.",
              "confidence must be a number from 0 to 100.",
              "Do not put transaction mode in normalized_party_name. UPI, NEFT, RTGS, IMPS, CHEQUE, CASH, SALARY, TRANSFER, CHARGE, and INTEREST are never party names by themselves.",
              "Bad party examples: PUNIT VASAI MUMBAI, SHOAIB VASAI MUMBAI, MUMBAI, VASAI, SALARY, UPI, NEFT.",
              "Good party examples: PUNIT, SHOAIB SALIM FUMAKIYA, RAMZAN HASNANI, UNIQUE ENTERPRISES.",
              "Remove locations and branch/address tokens before party resolution: MUMBAI, VASAI, MAHARASHTRA, MHIN, IND, USA, branch names and state/city words.",
              "Ignore OCR garbage and banking metadata as counterparties: YOU ARE, PAID VIA, UPIINTE, PAYVIAR, MANDATE, EXECUTE, COLLECT, BANK, GST, TDS, REFUND, OUTWARD, INWARD, ADVANCE, SALARY, REMAINING, TRANSFER, CHARGE, SMS CHARGE, ANNUAL FEE, CARD FEE, INTEREST.",
              "Ignore bank/rail/reference tokens as counterparties: UTIB, ICIC, SBIN, KKBK, HDFC, BARB, BARB0XXXX, IFSC codes, UTR numbers, transaction ids, SI references, mandate ids, autopay ids, sweep ids, settlement ids, cheque/reference numbers.",
              "Merge spelling differences, OCR spacing errors, split words, bank-code suffixes, payment-rail suffixes, and location suffixes when they are the same person/business.",
              "Do not merge unrelated people just because they share the same branch, city, payment rail, or mode.",
              "If narration contains both a real party and tax words like GST, GSTPT, GST PAYMENT, PTRC, or TDS, keep the real party and set category TAX PAYMENT.",
              "If narration contains salary words like SALARY, APRILSALARY, MAYSALARY, JULYSALARY, or JANSALARY, extract the employee name as normalized_party_name and set party_type/category SALARY.",
              "Example: OPM PRASH PRAMOD DALVI 6312 SALARY becomes normalized_party_name PRASH PRAMOD DALVI, party_type PERSON, category SALARY.",
              "If the transaction is only a bank charge, fee, interest, sweep, or settlement with no outside party, use BANK CHARGES, BANK INTEREST, BANK SWEEP, or BANK SETTLEMENT as normalized_party_name.",
              "Example group: UPI/123456789/ZEENAT RAMZAN HASNANI, NEFT ZEENAT RAMZAN HASNANI, RTGS TO ZEENAT RAMZA N HASNANI, and CHQ ZEENAT RAM ZAN HASNANI all become ZEENAT RAMZAN HASNANI.",
              "Example group: EDUGUIDE OVE RSEAS STUDIES PVT LTD, EDUGUIDE OVERSEA S STUDIES PVT LTD, and EDUGUIDE OVERSEAS STUDIES PVT LTD all become EDUGUIDE OVERSEAS STUDIES PVT LTD.",
              "Example group: JAL PA RAITHATHA AND CO, JALPA RA ITHATHA AND CO, and JALP A RAITHATHA AND CO all become JALPA RAITHATHA AND CO.",
              "Example group: COM FORT ZONE SERVICES, COMFORT ZONE SERVI CES, and COMFORT ZONE SERVICES all become COMFORT ZONE SERVICES.",
              "Example group: UNIQUE ENTERP RISES and UNIQUE ENTERPRISES become UNIQUE ENTERPRISES.",
              "Example group: ELWEISS MUTUAL, EDELWEISS MUTUAL, and EDELWE ISS MUTUAL become EDELWEISS MUTUAL.",
              "Example group: MR RAMZA, MR RAMZAN, RAMZAN HASNANI, and MR RAMZAN HASNANI become RAMZAN HASNANI.",
              "Example group: SWAPNILS, SWAPNIL, and SWAPNILS U TIB SWAPNIL become SWAPNIL.",
              "Example group: PRASH PR, PRASHDA, and PRASH PRAMOD DALVI become PRASH PRAMOD DALVI.",
              "Example: SI HGAFP0F1EE0208523214 MSEDCL becomes normalized_party_name MSEDCL, party_type UTILITY, category UTILITY.",
              "Example: SHOAIB SALIM FUMAKIY, SHOAIB SALIM FUMAKIYA DCBL, and SHOAIB VASAI MUMBA are the same party: SHOAIB SALIM FUMAKIYA.",
              "For CASH DEPOSIT BY - PUNIT - VASAI MUMBAI, normalized_party_name is PUNIT and category is CASH.",
              "For CASH DEPOSIT BY - SHOAIB - VASAI MUMBAI, normalized_party_name should merge with fuller Shoaib names when present, e.g. SHOAIB SALIM FUMAKIYA.",
              "For CASH DEPOSIT CHARGES references like CDT251173231, normalized_party_name is BANK CHARGES and category is BANK CHARGES.",
              "Merchant canonicalization: AMAZON P, AMAZON I, AMAZONP, and AMZNPLT become AMAZON.",
              "Merchant canonicalization: SWIGGY ICI C, SWIGGY UTI B, and SWIGGY PAY20FO become SWIGGY.",
              "Merchant canonicalization: APPLE ME, APPLESE, and APPLE BILLDES become APPLE.",
              "Merchant canonicalization: GOOGLE WORKSPACE CYBS and GOOGLE WORKSPACE become GOOGLE WORKSPACE.",
              "Merchant canonicalization: BLINKIT HDFC and BLINKIT PAYVIAR become BLINKIT.",
              "Subscription examples include GOOGLE WORKSPACE, APPLE, LINKEDIN, ELEVENLABS, SUNO, CANVA, APOLLO.IO, GO DADDY, MICROSOFT.",
              "Business examples include UNIQUE ENTERPRISES, RMH ADVISORS, NEW THING MEDIA PRIVATE LIMITED, LESSSGO MEDIA PRIVATE LIMITED.",
              "Person examples include RAMZAN HASNANI, PRASH PRAMOD DALVI, SALONI FAIYAZ SURTI, DHRUVIN DOSHI.",
              "The app calculates transaction_count, debit_amount, credit_amount, net_amount, and transaction_modes from your normalized_party_name values.",
            ],
            rows,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq party resolver failed with status ${response.status}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content || "";
  const parsed = extractJsonObject(content);
  return validateRows(parsed, allowedIds);
}

export async function resolvePartiesWithGroq(
  transactions: NormalizedTransaction[],
): Promise<Map<string, GroqPartyResolution>> {
  const config = getGroqConfig();
  const result = new Map<string, GroqPartyResolution>();

  if (!config.enabled || !config.apiKey || transactions.length === 0) {
    return result;
  }

  const rows = compactRows(transactions);
  const batches = chunkRowsByPayload(rows, MAX_BATCH_SIZE, MAX_BATCH_PAYLOAD_CHARS);

  async function resolveWithRetry(batch: typeof rows): Promise<void> {
    try {
      const resolved = await resolveBatch(batch, config);
      resolved.forEach((row) => result.set(row.txnId, row));
    } catch (error) {
      if (batch.length > 1) {
        const midpoint = Math.ceil(batch.length / 2);
        await resolveWithRetry(batch.slice(0, midpoint));
        await resolveWithRetry(batch.slice(midpoint));
        return;
      }

      console.warn("Groq party resolver skipped a row:", error instanceof Error ? error.message : "Unknown error");
    }
  }

  for (const batch of batches) {
    await resolveWithRetry(batch);
  }

  return result;
}
