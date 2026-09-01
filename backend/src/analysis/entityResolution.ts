import {
  extractParty,
  isLikelyPartyToken,
  looksLikeBoilerplateSentence,
  MAX_PARTY_WORDS,
  stripBoilerplate,
  stripTrailingDigitSuffix,
  stripVpaSuffix,
  trimTokenPunctuation,
} from "./classification";

export type SummaryTxn = {
  id?: string;
  customParty?: string;
  aiParty?: string;
  aiCounterPartyLedger?: string;
  aiPartyConfidence?: number;
  excludedFromLedger?: boolean;
  party?: string;
  narration?: string;
  direction?: string;
  category?: string;
  mode?: string;
  debit?: number;
  credit?: number;
  amount?: number;
  dateText?: string;
  month?: string;
  monthKey?: string;
};

const FOOTER_PATTERNS = [
  /\*?\s*CLOSING\s+BALANCE/i,
  /EARMARKED\s+FOR\s+HOLD/i,
  /PAGE\s+\d+\s+OF\s+\d+/i,
  /CONTINUED\s+ON\s+NEXT/i,
];

const GENERIC_PARTIES = new Set([
  "SELF",
  "OWN",
  "OWN ACCOUNT",
  "UNKNOWN",
  "TRANSACTION",
  "UPI TXN",
  "NEFT CR",
  "NEFT DR",
]);

const STRIP_PREFIX =
  /^(UPI|IMPS|NEFT|RTGS|ACH|NACH|BIL|POS|ATM|ECS|SI|REV|REF|TO|FROM|BY|DR|CR|TXN|TRANSFER|TRF|PAYMENT|PAY|FUND|FUNDS|MOB|MB|MBK|TPFT|P2A|P2M|P2P|I2I)[\s\-\/]*/i;

const BANK_EVENT_PATTERNS: Array<{ test: RegExp; label: string }> = [
  { test: /\bSWEEP\b/i, label: "BANK SWEEP" },
  { test: /\bUPI\s+SETTLEMENT\b/i, label: "UPI SETTLEMENT" },
  { test: /\bSETTLEMENT\b/i, label: "BANK SETTLEMENT" },
  { test: /\bQUARTERLY\s+INTEREST\b/i, label: "BANK INTEREST" },
  { test: /\bINT\.?\s+ON\s+SWCR\b/i, label: "BANK INTEREST" },
  { test: /\bCASH\s+DEPOSIT\s+CHARGES?\b/i, label: "BANK CHARGES" },
  { test: /\bQR\s+CODE\s+CHGS?\b/i, label: "BANK CHARGES" },
  { test: /\bSGST\b/i, label: "BANK CHARGES" },
  { test: /\bCGST\b/i, label: "BANK CHARGES" },
  { test: /\bCHARGES?\/DR\b/i, label: "BANK CHARGES" },
  { test: /\bCHARGES?\s+FOR\b/i, label: "BANK CHARGES" },
  { test: /\bSMS[_\s]?CHARGE/i, label: "BANK CHARGES" },
  { test: /\bAUTOPAY\s+SI\b/i, label: "CARD AUTOPAY" },
  { test: /\bATM[_\s]?WDL[_\s]?DECL\b/i, label: "ATM DECLINED" },
  { test: /\bNFS\b/i, label: "ATM WITHDRAWAL" },
  { test: /\bBANK\s+REFERENCE\s+NO\b/i, label: "BANK REFERENCE" },
  { test: /\bREGD\.?\s+OFFICE\b|\bREGISTERED\s+OFFICE\b/i, label: "BANK NOTICE" },
];

/**
 * Own-account / self transfers -- a distinct concept from "we couldn't identify a party".
 * Checked alongside BANK_EVENT_PATTERNS so these surface as their own labeled group instead
 * of silently falling into Unrecognized (GENERIC_PARTIES already strips bare "SELF"/"OWN" as
 * too weak a signal to use as freeform party text, which used to mean every self-transfer
 * landed in the same bucket as truly-unresolvable narrations).
 */
const SELF_TRANSFER_PATTERNS: RegExp[] = [
  /\bSELF\s+TRANSFER\b/i,
  /\bTRANSFER\s+TO\s+SELF\b/i,
  /\bOWN\s+ACCOUNT\b/i,
  /\bOWN\s+A\/?C\b/i,
  /\b(?:TO|FROM)\s+SELF\b/i,
  /\bSELF\s*[-:]?\s*A\/?C\b/i,
];

const BANK_CODE_MAP: Record<string, string> = {
  UTIB: "AXIS BANK",
  ICIC: "ICICI BANK",
  SBIN: "STATE BANK OF INDIA",
  HDFC: "HDFC BANK",
  KKBK: "KOTAK MAHINDRA BANK",
  IBKL: "IDBI BANK",
  CBIN: "CENTRAL BANK OF INDIA",
  MAHB: "BANK OF MAHARASHTRA",
  BARB: "BANK OF BARODA",
  YESB: "YES BANK",
  PUNB: "PUNJAB NATIONAL BANK",
};

const PAYMENT_RAIL_ALIASES: Array<{ test: RegExp; label: string }> = [
  { test: /\bPAY\s*TM\b|\bPAYTM\b|\bPA\s*Y\s*TM\b|\bPAYT\s*M\b/i, label: "PAYTM PAYMENTS" },
  { test: /\bPHONE\s*PE\b|\bPHO\s*NE\s*PE\b/i, label: "PHONEPE" },
  { test: /\bGOOGLE\s*PAY\b|\bGPAY\b/i, label: "GOOGLE PAY" },
];

const MERCHANT_ALIASES: Array<{ test: RegExp; label: string }> = [
  ...PAYMENT_RAIL_ALIASES,
  { test: /\bGOOGLE\s*PLAY\b/i, label: "GOOGLE PLAY" },
  { test: /\bGOOGLE\s*WORKSPACE\b/i, label: "GOOGLE WORKSPACE" },
  { test: /\bAMAZON\b|\bAMZN\b/i, label: "AMAZON" },
  { test: /\bFLIPKART\b/i, label: "FLIPKART" },
  { test: /\bMYNTRA\b/i, label: "MYNTRA" },
  { test: /\bAJIO\b/i, label: "AJIO" },
  { test: /\bNYKAA\b/i, label: "NYKAA" },
  { test: /\bMEESHO\b/i, label: "MEESHO" },
  { test: /\bAIRTEL\b/i, label: "AIRTEL" },
  { test: /\bMSEDCL\b/i, label: "MSEDCL" },
  { test: /\bVODAFONE\b|\bVI\s+POST\b/i, label: "VODAFONE IDEA" },
  { test: /\bCBDT\b/i, label: "CBDT" },
  { test: /\bGODADDY\b/i, label: "GODADDY" },
  { test: /\bBLINKIT\b/i, label: "BLINKIT" },
  { test: /\bZOMATO\b|\bPAYZOMA\b/i, label: "ZOMATO" },
  { test: /\bSWIGGY\b/i, label: "SWIGGY" },
  { test: /\bUBER\b/i, label: "UBER" },
  { test: /\bOLA\b(?!\s*BUS)/i, label: "OLA" },
  { test: /\bRAPIDO\b/i, label: "RAPIDO" },
  { test: /\bIRCTC\b/i, label: "IRCTC" },
  { test: /\bMAKEMYTRIP\b|\bMMT\b/i, label: "MAKEMYTRIP" },
  { test: /\bBOOKMYSHOW\b|\bBMS\b/i, label: "BOOKMYSHOW" },
  { test: /\bNETFLIX\b/i, label: "NETFLIX" },
  { test: /\bHOTSTAR\b/i, label: "DISNEY+ HOTSTAR" },
  { test: /\bSPOTIFY\b/i, label: "SPOTIFY" },
  { test: /\bZEE5\b/i, label: "ZEE5" },
  { test: /\bSONYLIV\b|\bSONY\s*LIV\b/i, label: "SONYLIV" },
  { test: /\bBIGBASKET\b/i, label: "BIGBASKET" },
  { test: /\bDUNZO\b/i, label: "DUNZO" },
  { test: /\bJIOMART\b/i, label: "JIOMART" },
  { test: /\bDMART\b/i, label: "DMART" },
  { test: /\bZERODHA\b/i, label: "ZERODHA" },
  { test: /\bGROWW\b/i, label: "GROWW" },
  { test: /\bUPSTOX\b/i, label: "UPSTOX" },
  { test: /\bICICI\s*(?:DIRECT|SECURITIES)\b/i, label: "ICICI SECURITIES" },
  { test: /\bEDELWEISS\b/i, label: "EDELWEISS" },
  { test: /\bPOLICYBAZAAR\b/i, label: "POLICYBAZAAR" },
  { test: /\bCRED\b(?!IT)/i, label: "CRED" },
  { test: /\bRAZORPAY\b/i, label: "RAZORPAY" },
  { test: /\bCASHFREE\b/i, label: "CASHFREE" },
  { test: /\bBILLDESK\b/i, label: "BILLDESK" },
  { test: /\bCCAVENUE\b/i, label: "CCAVENUE" },
  { test: /\bINSTAMOJO\b/i, label: "INSTAMOJO" },
  { test: /\bLINKEDIN\b/i, label: "LINKEDIN" },
  { test: /\bMICROSOFT\b|\bMSFT\b/i, label: "MICROSOFT" },
  { test: /\bAPPLE\.COM\b|\bAPPLE\s+INDIA\b|\bITUNES\b/i, label: "APPLE" },
  { test: /\bCANVA\b/i, label: "CANVA" },
  { test: /\bELEVENLABS\b/i, label: "ELEVENLABS" },
  { test: /\bDOMINOS?\b/i, label: "DOMINO'S" },
  { test: /\bMCDONALDS?\b|\bMC\s*DONALD/i, label: "MCDONALD'S" },
  { test: /\bSTARBUCKS\b/i, label: "STARBUCKS" },
  { test: /\bDECATHLON\b/i, label: "DECATHLON" },
];

const UPI_RAIL_SEGMENT =
  /@|PAYTM|PHONEPE|GPAY|GOOGLEPAY|\bQR\b|YESB0|SBIN0|HDFC0|ICIC0|UTIB0|BARB0|PTYBL|NAVI0/i;

const ABBREV_EXPANSIONS: Array<[RegExp, string]> = [
  [/\bASSO\b/gi, "ASSOCIATES"],
  [/\bPVT\b/gi, "PVT"],
  [/\bLTD\b/gi, "LTD"],
  [/\bLLP\b/gi, "LLP"],
];

const LOCATION_WORDS = new Set([
  "VASAI",
  "MUMBAI",
  "MUMB",
  "WEST",
  "EAST",
  "NAGAR",
  "NALLASOPARA",
  "PALGHAR",
  "MAHARASHTRA",
  "INDIA",
  "ST",
  "WE",
  "AI",
  "BAI",
  "VAS",
  "MUM",
  "MUMBA",
  "THANE",
  "BOMBAY",
  "SOCIETY",
  "APARTMENT",
  "APARTMENTS",
  "CHS",
  "MANDIR",
  "COLONY",
  "SECTOR",
]);

const BANK_PREFIX_WORDS = new Set([
  "SBIN",
  "HDFC",
  "KVBL",
  "DCBL",
  "IBKL",
  "YESB",
  "KKBK",
  "ICIC",
  "AXIS",
  "UTIB",
  "BARB",
  "CBIN",
  "MAHB",
  "PUNB",
  "IDFB",
  "FDRL",
  "CNRB",
  "SRCB",
  "VVSB",
  "UBIN",
  "INDB",
  "IBKR",
  "BOI",
  "SIB",
  "CSB",
  "IBL",
  "DHAN",
  "IDBI",
]);

function isRailReferenceToken(token: string): boolean {
  const t = token.toUpperCase();
  return (
    /^HDFC[RNCH]\d*$/i.test(t) ||
    /^NCB\d+$/i.test(t) ||
    /^YESAP\d+$/i.test(t) ||
    /^AXNPN\d+$/i.test(t) ||
    /^IN\d+$/i.test(t) ||
    /^UTR\d+$/i.test(t)
  );
}

function stripBankLocationTokens(tokens: string[]): string[] {
  return tokens.filter((token) => {
    const t = token.toUpperCase();
    if (BANK_PREFIX_WORDS.has(t)) return false;
    if (LOCATION_WORDS.has(t)) return false;
    if (isRailReferenceToken(t)) return false;
    return true;
  });
}

function collapseBusinessTokens(tokens: string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index].toUpperCase();
    const next = tokens[index + 1]?.toUpperCase();
    if (current === "S" && next === "S") {
      out.push("SS");
      index += 1;
      continue;
    }
    if (current === "S" && next === "AND") {
      out.push("S");
      continue;
    }
    out.push(tokens[index]);
  }
  return out;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function extractTransactionMode(txnOrNarration: SummaryTxn | string): string {
  const narration =
    typeof txnOrNarration === "string"
      ? txnOrNarration
      : `${txnOrNarration.mode ?? ""} ${txnOrNarration.narration ?? ""}`;
  const text = narration.toUpperCase();
  if (/\bUPI\b/.test(text)) return "UPI";
  if (/\bIMPS\b/.test(text)) return "IMPS";
  if (/\bNEFT\b/.test(text)) return "NEFT";
  if (/\bRTGS\b/.test(text)) return "RTGS";
  if (/\bCHQ\b|\bCHEQUE\b|\bCLG\b/.test(text)) return "CHEQUE";
  if (/\bCARD\b|\bPOS\b/.test(text)) return "CARD";
  if (/\bACH\b|\bNACH\b|\bECS\b/.test(text)) return "ACH";
  if (/\bAUTOPAY\b/.test(text)) return "AUTOPAY";
  if (/\bSI\b/.test(text)) return "SI";
  if (/\bCASH\b|\bATM\b/.test(text)) return "CASH";
  if (/\bSWEEP\b/.test(text)) return "SWEEP";
  if (/\bINTEREST\b|\bINT\.?\b/.test(text)) return "INTEREST";
  if (/\bCHARGES?\b|\bFEE\b|\bPENAL\b/.test(text)) return "BANK CHARGES";
  if (/\bTRANSFER\b|\bTRF\b|\bTPT\b/.test(text)) return "TRANSFER";
  return "TRANSFER";
}

export function repairOcrSpacing(text: string): string {
  let out = text;
  const repairs: Array<[RegExp, string]> = [
    [/\bPH\s+ONE\b/gi, "PHONE"],
    [/\bPHO\s+NE\b/gi, "PHONE"],
    [/\bP\s+HONE\b/gi, "PHONE"],
    [/\bPAYT\s+M\b/gi, "PAYTM"],
    [/\bPA\s+YTM\b/gi, "PAYTM"],
    [/\bSERVI\s+CES\b/gi, "SERVICES"],
    [/\bAUT\s+OMATION\b/gi, "AUTOMATION"],
    [/\bENTER\s+PRISE\b/gi, "ENTERPRISE"],
    [/\bMER\s+CHANT\b/gi, "MERCHANT"],
    [/\bCOC\s+ONUT\b/gi, "COCONUT"],
    [/\bTRAINI\s+NG\b/gi, "TRAINING"],
    [/\bOVE\s+RSEAS\b/gi, "OVERSEAS"],
    [/\bOVERSEA\s+S\b/gi, "OVERSEAS"],
    [/\bMANUFACTURI\s+NG\b/gi, "MANUFACTURING"],
    [/\bRAJ\s+ESH\b/gi, "RAJESH"],
    [/\bIN\s+DIA\b/gi, "INDIA"],
    [/\bCOM\s+FORT\b/gi, "COMFORT"],
    [/\bZE\s+ENAT\b/gi, "ZEENAT"],
    [/\bRAMZA\s+N\b/gi, "RAMZAN"],
    [/\bRAM\s+ZAN\b/gi, "RAMZAN"],
    [/\bHAS\s+NANI\b/gi, "HASNANI"],
    [/\bJAL\s+PA\b/gi, "JALPA"],
    [/\bJALP\s+A\b/gi, "JALPA"],
    [/\bRA\s+ITHATHA\b/gi, "RAITHATHA"],
    [/\bMANSO\s+ORALI\b/gi, "MANSOORALI"],
    [/\bCHANDRASHEKHA\s+R\b/gi, "CHANDRASHEKHAR"],
  ];
  for (const [pattern, replacement] of repairs) {
    out = out.replace(pattern, replacement);
  }
  return normalizeWhitespace(out);
}

function isFooterGarbage(text: string): boolean {
  return FOOTER_PATTERNS.some((p) => p.test(text));
}

/**
 * Filters a token list for display/clustering. Delegates to the same channel/process-word
 * and reference-code checks the extractor uses (classification.ts), so a token that was
 * good enough to survive extraction is never re-rejected here for a different reason, and
 * vice versa -- one shared definition of "noise" for the whole pipeline.
 */
function stripReferenceTokens(tokens: string[]): string[] {
  return tokens
    .map((token) => trimTokenPunctuation(token))
    .map((token) => stripTrailingDigitSuffix(token))
    .filter((token) => isLikelyPartyToken(token));
}

function stripTrailingNumericCodes(text: string): string {
  return text
    .replace(/\b([A-Z]{3,8})\d{4,}\b/gi, "$1")
    .replace(/\b[A-Z]{2,4}\d{10,}\b/gi, "")
    .replace(/\b[A-Z]{4}0[A-Z0-9]+\b/gi, " ")
    .replace(/\d{6,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFromSiMandate(narration: string): string | null {
  const match = narration.match(/\bSI\s+[A-Z0-9]{8,}\s+(.+)$/i);
  if (match?.[1]) return normalizeWhitespace(match[1]);
  return null;
}

function extractBankCodeEntity(text: string): string | null {
  const upper = text.toUpperCase();
  for (const [code, bank] of Object.entries(BANK_CODE_MAP)) {
    if (new RegExp(`\\b${code}\\b`).test(upper)) return bank;
  }
  if (/\bBARB0[A-Z0-9]+\b/i.test(upper)) return "BANK OF BARODA";
  return null;
}

const PAYMENT_RAIL_LABELS = new Set(PAYMENT_RAIL_ALIASES.map((alias) => alias.label));

function matchMerchantAlias(text: string, options?: { includePaymentRails?: boolean }): string | null {
  const pool =
    options?.includePaymentRails === false
      ? MERCHANT_ALIASES.filter((alias) => !PAYMENT_RAIL_LABELS.has(alias.label))
      : MERCHANT_ALIASES;
  for (const alias of pool) {
    if (alias.test.test(text)) return alias.label;
  }
  return null;
}

function isGarbagePartyIdentifier(party: string): boolean {
  const upper = party.trim().toUpperCase();
  if (!upper || GENERIC_PARTIES.has(upper)) return true;
  if (/^[A-Z]{4}0[A-Z0-9]{8,}/.test(upper)) return true;
  if (/^(YESB|SBIN|HDFC|ICIC|UTIB|BARB|KKBK|PUNB|CBIN|MAHB)\d/.test(upper)) return true;
  if (/\d{10,}/.test(upper) && /[A-Z]{4,}/.test(upper)) return true;
  if (/^(UPI|NEFT|RTGS|IMPS)[\s\-/]/.test(upper)) return true;
  if (looksLikeBoilerplateSentence(upper)) return true;
  return false;
}

function isPaymentRailEntity(entity: string): boolean {
  return PAYMENT_RAIL_ALIASES.some((alias) => alias.label === entity.toUpperCase());
}

function extractUpiHyphenCounterparty(narration: string): string | null {
  const text = repairOcrSpacing(narration);
  const match = text.match(/\bUPI[-/](.+)$/i);
  if (!match?.[1]) return null;

  const segments = match[1].split("-").map((part) => normalizeWhitespace(part)).filter(Boolean);
  for (const segment of segments) {
    if (segment.includes("@")) {
      // A VPA segment ("dineshjogle086-5@ok") -- the handle before '@' is usually the best
      // signal available, so pull it out instead of discarding the whole segment. Pure
      // payment-rail handles (paytm/phonepe/gpay with no other text) still get skipped.
      const handle = stripTrailingDigitSuffix(segment.split("@")[0].trim());
      if (handle && !UPI_RAIL_SEGMENT.test(handle) && handle.length >= 4) {
        const entity = normalizePartyName(handle);
        if (entity && entity !== "UNRECOGNIZED" && entity.length >= 3) return entity;
      }
      continue;
    }
    if (UPI_RAIL_SEGMENT.test(segment)) continue;
    if (/^\d{6,}$/.test(segment)) continue;
    if (/^[A-Z]{4}0[A-Z0-9]+$/i.test(segment)) continue;
    const entity = normalizePartyName(stripTrailingDigitSuffix(segment));
    if (entity && entity !== "UNRECOGNIZED" && entity.length >= 3) return entity;
  }
  return null;
}

function extractCashDepositCounterparty(narration: string): string | null {
  const text = repairOcrSpacing(narration.toUpperCase());
  const match = text.match(/\bCASH\s+DEPOSIT\s+BY\s*[-: ]+(.+)$/i);
  if (!match?.[1]) return null;

  const parts = match[1]
    .split(/\s+-\s+|-/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
  const namePart = parts[0] || "";
  const cleaned = normalizePartyName(namePart);

  if (!cleaned || cleaned === "UNRECOGNIZED" || LOCATION_WORDS.has(cleaned)) return null;
  return cleaned;
}

/**
 * Checks that should win regardless of narration format: a known brand/merchant name
 * anywhere in the text, or a bank-initiated event (settlement, sweep, charges) that isn't a
 * counterparty at all. Run before any of the format-specific extractors below so a mangled
 * "MOB ZOMATO" or a "UPI SETTLEMENT -WW8951- 03/04/24" narration always resolves to the
 * clean label instead of whatever fragment the format-specific parsing would have produced.
 */
function checkKnownPatterns(rawNarration: string): { entity: string; confidence: number } | null {
  if (!rawNarration || isFooterGarbage(rawNarration)) return null;
  // Some narrations use "_" as a word separator (SMS_CHARGE_FOR_JAN25); normalize to spaces
  // so \b boundaries in BANK_EVENT_PATTERNS work the way they would for a space-separated
  // narration ("_" is itself a \w character, so "CHARGE\b" would not match "CHARGE_FOR").
  const cleaned = stripBoilerplate(rawNarration.replace(/_/g, " "));
  if (!cleaned) return null;

  for (const { test, label } of BANK_EVENT_PATTERNS) {
    if (test.test(cleaned) && cleaned.length < 120) {
      return { entity: label, confidence: 85 };
    }
  }

  if (cleaned.length < 120 && SELF_TRANSFER_PATTERNS.some((p) => p.test(cleaned))) {
    return { entity: "SELF / INTERNAL TRANSFER", confidence: 80 };
  }

  // Payment rails (Paytm/PhonePe/GPay) are excluded here: in a UPI narration they are
  // almost always just the *channel* a payment to some other, real counterparty moved
  // through ("...-RAMZAN HASNANI-YESB0000-paytm"), not the counterparty itself. Matching
  // them this early would short-circuit extraction before the more specific UPI/name
  // parsing below gets a chance to find the actual name. They remain available as a
  // last-resort fallback further down the pipeline (extractEntityFromText).
  const merchant = matchMerchantAlias(cleaned, { includePaymentRails: false });
  if (merchant) return { entity: merchant, confidence: 95 };

  return null;
}

function extractCounterpartyFromNarration(narration: string): { entity: string; confidence: number } | null {
  const known = checkKnownPatterns(narration);
  if (known) return known;

  const cashCounterparty = extractCashDepositCounterparty(narration);
  if (cashCounterparty) {
    return { entity: cashCounterparty, confidence: Math.max(92, scoreEntity(cashCounterparty)) };
  }

  const upiCounterparty = extractUpiHyphenCounterparty(narration);
  if (upiCounterparty) {
    return { entity: upiCounterparty, confidence: Math.max(90, scoreEntity(upiCounterparty)) };
  }

  const fromClassifier = extractParty(narration);
  if (fromClassifier && !isGarbagePartyIdentifier(fromClassifier)) {
    const entity = normalizePartyName(fromClassifier);
    if (entity !== "UNRECOGNIZED") {
      return { entity, confidence: Math.max(85, scoreEntity(entity)) };
    }
  }

  const siMerchant = extractFromSiMandate(narration);
  if (siMerchant) {
    const entity = normalizePartyName(siMerchant);
    if (entity.length >= 3) {
      return { entity, confidence: 88 };
    }
  }

  return null;
}

function expandAbbreviations(text: string): string {
  let out = text;
  for (const [pattern, replacement] of ABBREV_EXPANSIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Labels the pipeline itself assigns (BANK_EVENT_PATTERNS, MERCHANT_ALIASES) are already
 * canonical -- running them back through the noise-token filter would strip words like
 * "CHARGES" out of "BANK CHARGES" for the exact same reason it strips them out of raw
 * narration text. Recognize and pass them through untouched.
 */
const KNOWN_CANONICAL_LABELS = new Set([
  ...BANK_EVENT_PATTERNS.map((e) => e.label.toUpperCase()),
  ...MERCHANT_ALIASES.map((e) => e.label.toUpperCase()),
  "SELF / INTERNAL TRANSFER",
]);

/** A result made up only of joiner words ("AND", "OR", ...) isn't a usable party name. */
function isConnectorOnly(value: string): boolean {
  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((t) => ["AND", "OR", "THE", "OF", "&"].includes(t));
}

/**
 * @param enforceLengthCap Reject (fall back to UNRECOGNIZED) results longer than
 * MAX_PARTY_WORDS -- the same "this is a paragraph, not a name" guard used everywhere else in
 * the pipeline. Left on by default since almost every caller is normalizing freshly-extracted
 * narration text. Turned off for explicitly user- or AI-assigned party names (customParty /
 * aiParty): those are a deliberate decision someone/something already made, not a residue of
 * noisy text-parsing, so this function should clean them up cosmetically without ever
 * second-guessing and discarding the assignment itself.
 */
export function normalizePartyName(label: string, enforceLengthCap = true): string {
  const upperLabel = label.trim().toUpperCase();
  if (KNOWN_CANONICAL_LABELS.has(upperLabel)) return upperLabel;

  let entity = repairOcrSpacing(label.toUpperCase());
  entity = entity.replace(/[^A-Z0-9\s.&]/g, " ");
  entity = normalizeWhitespace(entity);
  entity = stripTrailingNumericCodes(entity);
  entity = stripReferenceTokens(entity.split(/\s+/)).join(" ");
  entity = expandAbbreviations(entity);
  entity = normalizeWhitespace(entity);
  if (!entity || isConnectorOnly(entity)) return "UNRECOGNIZED";
  if (enforceLengthCap && entity.split(/\s+/).length > MAX_PARTY_WORDS) return "UNRECOGNIZED";
  return entity;
}

export function entityClusterKey(label: string): string {
  const upperLabel = label.trim().toUpperCase();
  if (KNOWN_CANONICAL_LABELS.has(upperLabel)) return upperLabel;

  let key = repairOcrSpacing(label.toUpperCase());
  key = key.replace(/[^A-Z0-9\s]/g, " ");
  key = normalizeWhitespace(key);
  key = stripTrailingNumericCodes(key);
  let tokens = stripReferenceTokens(key.split(/\s+/));
  tokens = stripBankLocationTokens(tokens);
  tokens = collapseBusinessTokens(tokens);
  if (tokens.length === 0) return "UNRECOGNIZED";
  return tokens.join(" ");
}

function scoreEntity(label: string): number {
  const tokens = label.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  if (label === "UNRECOGNIZED") return 0;
  let score = Math.min(70, 45 + tokens.length * 8);
  if (/\b(LTD|LLP|PVT|ASSOCIATES|BANK|HOMES|ENTERPRISE|STUDIES)\b/i.test(label)) score += 20;
  if (label.length >= 8) score += 15;
  if (/^[A-Z]{2,4}$/.test(label)) score -= 20;
  return Math.max(0, Math.min(98, score));
}

function rawPartyAliasFromNarration(raw: string): string | null {
  if (!raw) return null;
  let text = stripVpaSuffix(raw.toUpperCase());
  text = text.replace(/[-_/:,@()#]+/g, " ");
  text = normalizeWhitespace(text);
  text = text.replace(STRIP_PREFIX, "");
  text = stripTrailingNumericCodes(text);
  const tokens = stripReferenceTokens(text.split(/\s+/).filter(Boolean));
  if (tokens.length === 0 || tokens.length > MAX_PARTY_WORDS) return null;
  const alias = normalizeWhitespace(tokens.join(" "));
  return alias.length >= 3 ? alias : null;
}

export function extractEntityFromText(raw: string): { entity: string; confidence: number } {
  if (!raw || isFooterGarbage(raw)) {
    return { entity: "UNRECOGNIZED", confidence: 0 };
  }

  const counterparty = extractCounterpartyFromNarration(raw);
  if (counterparty) return counterparty;

  let text = repairOcrSpacing(raw.toUpperCase());
  text = stripBoilerplate(text);
  text = stripVpaSuffix(text);
  text = text.replace(/[-_/:,@()#]+/g, " ");
  text = normalizeWhitespace(text);
  text = text.replace(STRIP_PREFIX, "");
  text = stripTrailingNumericCodes(text);

  if (looksLikeBoilerplateSentence(text)) {
    return { entity: "UNRECOGNIZED", confidence: 0 };
  }

  const siMerchant = extractFromSiMandate(raw);
  if (siMerchant) {
    const siAlias = matchMerchantAlias(siMerchant);
    if (siAlias) return { entity: siAlias, confidence: 92 };
    const siClean = expandAbbreviations(repairOcrSpacing(siMerchant.toUpperCase()));
    if (siClean.length >= 3) return { entity: siClean, confidence: 88 };
  }

  const bankEntity = extractBankCodeEntity(text);
  if (bankEntity && text.split(/\s+/).length <= 4) {
    return { entity: bankEntity, confidence: 75 };
  }

  let tokens = stripReferenceTokens(text.split(/\s+/).filter(Boolean));
  tokens = tokens.filter((t) => !GENERIC_PARTIES.has(t) && t.length > 1);
  if (tokens.length === 0) return { entity: "UNRECOGNIZED", confidence: 0 };
  // More surviving tokens than any real name/business runs to means this is a paragraph
  // (address block, leaked customer-info text) that happens to be mostly proper-noun-shaped
  // words rather than banking jargon -- reject it instead of joining the whole thing into one
  // giant "party".
  if (tokens.length > MAX_PARTY_WORDS) return { entity: "UNRECOGNIZED", confidence: 0 };

  let entity = normalizePartyName(tokens.join(" "));

  const aliasAfter = matchMerchantAlias(entity, { includePaymentRails: false });
  if (aliasAfter) return { entity: aliasAfter, confidence: 93 };

  const paymentRail = matchMerchantAlias(entity, { includePaymentRails: true });
  if (paymentRail && isPaymentRailEntity(paymentRail)) {
    return { entity: paymentRail, confidence: 70 };
  }

  if (/^[0-9\s]+$/.test(entity)) return { entity: "UNRECOGNIZED", confidence: 0 };
  if (entity.length < 3) return { entity: "UNRECOGNIZED", confidence: 5 };
  if (tokens.length === 1 && tokens[0].length <= 4) return { entity: "UNRECOGNIZED", confidence: 10 };

  return { entity, confidence: scoreEntity(entity) };
}

export function extractEntityFromTransaction(txn: SummaryTxn): { entity: string; confidence: number } {
  const narration = (txn.narration ?? "").toString();
  const party = (txn.party ?? "").toString().trim();
  const partyIsGarbage = isGarbagePartyIdentifier(party);

  if (/\bEMI\b/i.test(narration) && (!party || partyIsGarbage || !isRecognizablePartyName(party))) {
    return { entity: "EMI PAYMENT", confidence: 80 };
  }

  const narrationCounterparty = extractCounterpartyFromNarration(narration);
  if (narrationCounterparty && !isPaymentRailEntity(narrationCounterparty.entity)) {
    return narrationCounterparty;
  }

  const attempts: string[] = [];
  if (party && !partyIsGarbage && !GENERIC_PARTIES.has(party.toUpperCase())) {
    attempts.push(party);
  }
  attempts.push(narration);
  // Concatenating both fields is only safe when each is already short: two independently
  // substantial fields (e.g. a badly-parsed PDF column dumping address text into `party`)
  // compound into a longer, more mixed-up blob than either field alone -- the per-candidate
  // word cap downstream would reject an over-long result anyway, but a *moderately* long
  // party blended with a moderately long narration can still slip under that cap while
  // blending unrelated text. Only attempt the merge when both sides are already concise.
  const isShortField = (value: string) => value.trim().split(/\s+/).filter(Boolean).length <= 4;
  if (party && narration && !partyIsGarbage && isShortField(party) && isShortField(narration)) {
    attempts.push(`${party} ${narration}`);
  }

  let best = narrationCounterparty ?? { entity: "UNRECOGNIZED", confidence: 0 };
  for (const attempt of attempts) {
    const result = extractEntityFromText(attempt);
    if (result.confidence > best.confidence) best = result;
  }

  if (
    narrationCounterparty &&
    isPaymentRailEntity(best.entity) &&
    !isPaymentRailEntity(narrationCounterparty.entity)
  ) {
    return narrationCounterparty;
  }

  if (best.confidence < 25 && party && !partyIsGarbage) {
    const partyResult = extractEntityFromText(party);
    if (partyResult.confidence > best.confidence) best = partyResult;
  }

  return best;
}

function isRecognizablePartyName(party: string): boolean {
  const raw = party.trim().toUpperCase();
  if (!raw || GENERIC_PARTIES.has(raw)) return false;
  const hasLetters = /[A-Z]/.test(raw);
  const isAllDigits = /^[0-9]+$/.test(raw);
  const isIdLike = /^(?=.*\d)[A-Z0-9]{8,}$/.test(raw);
  return hasLetters && !isAllDigits && !isIdLike && raw.length >= 4;
}

export function classifySummaryLabelForTransaction(txn: SummaryTxn): string {
  const { entity, confidence } = extractEntityFromTransaction(txn);
  if (confidence >= 20 && entity !== "UNRECOGNIZED") return entity;
  return "UNRECOGNIZED";
}

/**
 * Coarse classification of *what kind of thing* a resolved party actually is, so a bank's own
 * sweep/settlement/interest/charge entries never get grouped and displayed as if they were a
 * normal counterparty, and a CA can tell at a glance which rows are real people/businesses.
 * This is a display-time classification computed from the already-resolved label; it doesn't
 * change grouping, aggregation, or the underlying canonical key.
 */
export type PartyType = "person" | "merchant" | "bank_system" | "charge" | "self" | "unrecognized";

const BANK_SYSTEM_LABELS = new Set([
  "BANK SWEEP",
  "UPI SETTLEMENT",
  "BANK SETTLEMENT",
  "ATM DECLINED",
  "ATM WITHDRAWAL",
  "BANK REFERENCE",
  "BANK NOTICE",
]);

const CHARGE_LABELS = new Set(["BANK INTEREST", "BANK CHARGES", "CARD AUTOPAY"]);

const MERCHANT_LABELS = new Set(MERCHANT_ALIASES.map((alias) => alias.label.toUpperCase()));

const SELF_LABELS = new Set([...GENERIC_PARTIES].map((s) => s.toUpperCase()).concat("SELF / INTERNAL TRANSFER"));

/** Business-entity words: if any of these show up, treat the party as a merchant/business
 * rather than guessing it is an individual's name. */
const BUSINESS_SUFFIX_PATTERN =
  /\b(PVT|PRIVATE|LTD|LIMITED|LLP|ENTERPRISES?|TRADING|TRADERS?|INDUSTR(?:Y|IES)|STORES?|ASSOCIATES?|COMPANY|AGENC(?:Y|IES)|SERVICES?|SOLUTIONS?|CONSTRUCTIONS?|ENGINEERS?|ELECTRONICS?|MART|FOODS?|SNACKS|SWEETS|BAKERY|PROVISION|KIRANA|MEDICAL|PHARMACY|HARDWARE|GARMENTS|TEXTILES|MOTORS|JEWELLERS?|JEWELLERY|RESTAURANT|HOTEL|SHOP|CORP(?:ORATION)?|GROUP)\b/i;

export function classifyPartyType(normalizedPartyName: string, confidence: number): PartyType {
  const upper = normalizedPartyName.trim().toUpperCase();
  if (!upper || upper === "UNRECOGNIZED" || confidence < 20) return "unrecognized";
  if (SELF_LABELS.has(upper)) return "self";
  if (CHARGE_LABELS.has(upper)) return "charge";
  if (BANK_SYSTEM_LABELS.has(upper)) return "bank_system";
  if (MERCHANT_LABELS.has(upper)) return "merchant";
  if (BUSINESS_SUFFIX_PATTERN.test(upper)) return "merchant";
  return "person";
}

function classifyPartyCategory(party: string, txn: SummaryTxn): string {
  const text = `${party} ${txn.category ?? ""} ${txn.narration ?? ""}`.toUpperCase();
  if (/\b(MSEDCL|MSEB|ELECTRIC|POWER|GAS|WATER|AIRTEL|JIO|VODAFONE|UTILITY)\b/.test(text)) return "UTILITY";
  if (/\b(GST|TDS|TAX|CBDT|PF|ESIC)\b/.test(text)) return "STATUTORY";
  if (/\b(BANK CHARGES|CHARGE|FEE|PENAL)\b/.test(text)) return "BANK CHARGES";
  if (/\b(BANK INTEREST|INTEREST|INT ON)\b/.test(text)) return "INTEREST";
  if (/\b(EMI|LOAN|NACH|ECS|FINANCE|FINSERV)\b/.test(text)) return "LOAN/EMI";
  if (/\b(SALARY|PAYROLL|WAGES)\b/.test(text)) return "SALARY";
  if (/\b(CASH)\b/.test(text)) return "CASH";
  return txn.category?.toUpperCase() || "OTHER";
}

export type PartyLedgerExtraction = {
  transaction_date: string;
  amount: number;
  debit_credit: string;
  transaction_mode: string;
  party_name: string;
  normalized_party_name: string;
  category: string;
  confidence: number;
  party_type: PartyType;
};

export function extractPartyLedgerFields(txn: SummaryTxn): PartyLedgerExtraction {
  const assignedParty = txn.customParty || txn.aiParty;
  if (assignedParty) {
    const debit = Number(txn.debit || 0);
    const credit = Number(txn.credit || 0);
    const debitCredit = credit >= debit ? "Credit" : "Debit";
    const normalizedParty = normalizePartyName(assignedParty, /* enforceLengthCap */ false);
    const confidence = txn.customParty ? 100 : Math.max(0, Math.min(100, Number(txn.aiPartyConfidence || 90)));
    return {
      transaction_date: txn.dateText ?? "",
      amount: Number(txn.amount ?? (debitCredit === "Credit" ? credit : debit) ?? 0),
      debit_credit: debitCredit,
      transaction_mode: extractTransactionMode(txn),
      party_name: assignedParty,
      normalized_party_name: normalizedParty,
      category: txn.customParty ? "USER ASSIGNED" : (txn.aiCounterPartyLedger || "AI ASSIGNED").toUpperCase(),
      confidence,
      // A user or the AI resolver explicitly named this party -- trust that judgment over the
      // suffix/alias heuristics used for auto-extracted labels.
      party_type: txn.customParty ? "person" : classifyPartyType(normalizedParty, confidence),
    };
  }

  const { entity, confidence } = extractEntityFromTransaction(txn);
  const normalized = confidence >= 20 ? normalizePartyName(entity) : "UNRECOGNIZED";
  const debit = Number(txn.debit || 0);
  const credit = Number(txn.credit || 0);
  const debitCredit = credit >= debit ? "Credit" : "Debit";

  return {
    transaction_date: txn.dateText ?? "",
    amount: Number(txn.amount ?? (debitCredit === "Credit" ? credit : debit) ?? 0),
    debit_credit: debitCredit,
    transaction_mode: extractTransactionMode(txn),
    party_name: entity,
    normalized_party_name: normalized,
    category: classifyPartyCategory(normalized, txn),
    confidence,
    party_type: classifyPartyType(normalized, confidence),
  };
}

export type TransactionSummaryRow = {
  party: string;
  txnCount: number;
  debit: number;
  credit: number;
  net: number;
  transactionModes: string[];
  aliases: string[];
  category: string;
  confidence: number;
  partyType: PartyType;
};

function pickCanonicalLabel(labels: string[]): Map<string, string> {
  const canonical = new Map<string, string>();
  const sorted = [...labels].sort((a, b) => b.length - a.length);

  for (const label of sorted) {
    const key = entityClusterKey(label);
    if (canonical.has(key)) continue;

    let best = label;
    const relatedKeys = new Set<string>([key]);
    for (const other of sorted) {
      if (other === label) continue;
      const otherKey = entityClusterKey(other);
      if (relatedKeys.has(otherKey)) continue;
      if (
        otherKey === key ||
        tokenSimilarity(key, otherKey) >= 0.85 ||
        singleTokenAlias(key, otherKey) ||
        singleTokenAlias(otherKey, key) ||
        isNamePartialVariant(key, otherKey)
      ) {
        if (other.length > best.length) best = other;
        relatedKeys.add(otherKey);
      }
    }
    const display = canonicalDisplayLabel(best);
    relatedKeys.forEach((relatedKey) => canonical.set(relatedKey, display));
  }
  return canonical;
}

/**
 * Same person, different slice of their full name -- a very common shape in Indian bank
 * narrations, where one entry captures "firstname + father's/middle name" and another
 * captures "firstname + surname", or a surname gets truncated/OCR-mangled by one character
 * ("MHATRE" -> "HATRE"/"MHA"). Requires an *exact* match on the first token (the strongest,
 * least ambiguous anchor available) before considering anything else, specifically so two
 * different people who merely share a common first name are never merged on that basis alone.
 */
function isNamePartialVariant(keyA: string, keyB: string): boolean {
  const a = keyA.split(/\s+/).filter(Boolean);
  const b = keyB.split(/\s+/).filter(Boolean);
  if (a.length < 2 || b.length < 2) return false;
  if (a[0] !== b[0]) return false;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length >= longer.length) {
    // Equal length: only a same-position, near-identical last token counts (truncation/OCR
    // noise on an otherwise-identical name), not a same-length name with a different surname.
    if (shorter.length !== longer.length) return false;
    for (let i = 1; i < shorter.length - 1; i++) {
      if (shorter[i] !== longer[i]) return false;
    }
    const shortLast = shorter[shorter.length - 1];
    const longLast = longer[longer.length - 1];
    return shortLast === longLast || tokensMatch(shortLast, longLast) || isCloseAffixOf(shortLast, longLast);
  }

  // Shorter is a strict subset: every one of its tokens (after the shared first token) must
  // appear, exactly or as a near-identical/truncated variant, somewhere in the longer name.
  const longRest = longer.slice(1);
  return shorter.slice(1).every((token) =>
    longRest.some((candidate) => candidate === token || tokensMatch(token, candidate) || isCloseAffixOf(token, candidate)),
  );
}

/** True when the shorter string is (near-)a prefix or suffix of the longer one -- catches
 * "MHA"/"MHATRE" and "HATRE"/"MHATRE" without the blanket edit-distance risk of matching
 * two genuinely different surnames of the same length (e.g. "PATEL" vs "PATIL"). */
function isCloseAffixOf(a: string, b: string): boolean {
  if (a.length < 3 || b.length < 3) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length === longer.length) return false;
  if (shorter.length / longer.length < 0.5) return false;
  return longer.startsWith(shorter) || longer.endsWith(shorter);
}

function canonicalDisplayLabel(label: string): string {
  const upperLabel = label.trim().toUpperCase();
  if (KNOWN_CANONICAL_LABELS.has(upperLabel)) return upperLabel;

  const repaired = repairOcrSpacing(label.toUpperCase()).replace(/[^A-Z0-9\s.&]/g, " ");
  const baseTokens = stripReferenceTokens(stripTrailingNumericCodes(repaired).split(/\s+/).filter(Boolean));
  const withoutBankCodes = baseTokens.filter((token) => {
    const t = token.toUpperCase();
    return !BANK_PREFIX_WORDS.has(t) && !isRailReferenceToken(t);
  });
  const withoutLocations = withoutBankCodes.filter((token) => !LOCATION_WORDS.has(token.toUpperCase()));
  const displayTokens = withoutLocations.length >= 2 ? withoutLocations : withoutBankCodes;
  return normalizeWhitespace(expandAbbreviations(displayTokens.join(" "))) || label;
}

function singleTokenAlias(shortKey: string, longKey: string): boolean {
  const shortTokens = shortKey.split(/\s+/).filter(Boolean);
  const longTokens = longKey.split(/\s+/).filter(Boolean);
  if (shortTokens.length !== 1 || longTokens.length < 2) return false;
  const [token] = shortTokens;
  if (token.length < 5) return false;
  return longTokens.some((candidate) => candidate === token);
}

function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  const longer = Math.max(a.length, b.length);
  const distance = levenshteinDistance(a, b);
  return 1 - distance / longer >= 0.84;
}

function levenshteinDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
}

function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(a.split(/\s+/).filter(Boolean));
  const tb = new Set(b.split(/\s+/).filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach((t) => {
    if ([...tb].some((candidate) => tokensMatch(t, candidate))) inter += 1;
  });
  return inter / Math.max(ta.size, tb.size);
}

export type PartyLedger = {
  summary: TransactionSummaryRow[];
  byParty: Map<string, SummaryTxn[]>;
};

/**
 * Single-pass computation of both the party summary rows and the party -> transactions
 * grouping. `buildTransactionSummary` and `groupTransactionsByParty` each used to run their
 * own extraction + canonicalization (the O(uniqueParties^2) fuzzy-matching in
 * `pickCanonicalLabel`) over the same transaction list; call sites that need both results
 * (the on-screen table, and every Excel module that renders a summary + detail sheets) were
 * doing that expensive work twice. Use this when both are needed.
 */
export function buildPartyLedger(transactions: SummaryTxn[]): PartyLedger {
  // Soft-deleted via the party manager panel -- excluded from every grouping/total, but the
  // caller's array (and therefore the underlying bank record) is left untouched.
  const includedTransactions = transactions.filter((txn) => !txn.excludedFromLedger);

  const rawLabels: string[] = [];
  const perTxn: Array<{
    txn: SummaryTxn;
    label: string;
    // Set only for a manually assigned party (txn.customParty). Bypasses the fuzzy
    // auto-detection clustering below entirely -- a user's explicit "put this under party
    // X" is authoritative and must never be silently merged into (or absorb) an unrelated
    // auto-detected group just because the names happen to share a token.
    manualParty: string | null;
    alias: string | null;
    debit: number;
    credit: number;
    mode: string;
    category: string;
    confidence: number;
  }> = [];

  includedTransactions.forEach((txn) => {
    const extraction = extractPartyLedgerFields(txn);
    const label = extraction.normalized_party_name;
    const manualParty = txn.customParty?.trim() || null;
    if (!manualParty) rawLabels.push(label);
    perTxn.push({
      txn,
      label,
      manualParty,
      alias: rawPartyAliasFromNarration(txn.narration ?? ""),
      debit: Number(txn.debit || 0),
      credit: Number(txn.credit || 0),
      mode: extraction.transaction_mode,
      category: extraction.category,
      confidence: extraction.confidence,
    });
  });

  const canonicalMap = pickCanonicalLabel([...new Set(rawLabels)]);

  const summary: Record<
    string,
    {
      party: string;
      txnCount: number;
      debit: number;
      credit: number;
      modes: Set<string>;
      aliases: Set<string>;
      categories: Map<string, number>;
      confidenceTotal: number;
    }
  > = {};
  const byParty = new Map<string, SummaryTxn[]>();

  perTxn.forEach(({ txn, label, manualParty, alias, debit, credit, mode, category, confidence }) => {
    const party = manualParty ?? canonicalMap.get(entityClusterKey(label)) ?? label;

    const groupList = byParty.get(party) ?? [];
    groupList.push(txn);
    byParty.set(party, groupList);

    if (!summary[party]) {
      summary[party] = {
        party,
        txnCount: 0,
        debit: 0,
        credit: 0,
        modes: new Set(),
        aliases: new Set(),
        categories: new Map(),
        confidenceTotal: 0,
      };
    }
    summary[party].txnCount += 1;
    summary[party].debit += debit;
    summary[party].credit += credit;
    summary[party].modes.add(mode);
    // Alias tracking is only meaningful for auto-detected clustering (surfacing the messy
    // narration variants folded into one group) -- a manually assigned party's normalized
    // label isn't a real alias, it's just a casing artifact of the same name.
    if (!manualParty) {
      if (label !== party) summary[party].aliases.add(label);
      if (alias && alias !== party && normalizePartyName(alias) === party) summary[party].aliases.add(alias);
    }
    summary[party].categories.set(category, (summary[party].categories.get(category) ?? 0) + 1);
    summary[party].confidenceTotal += confidence;
  });

  const summaryRows = Object.values(summary)
    .map((row) => {
      const confidence = Math.round(row.confidenceTotal / Math.max(row.txnCount, 1));
      return {
        party: row.party,
        txnCount: row.txnCount,
        debit: row.debit,
        credit: row.credit,
        net: row.credit - row.debit,
        transactionModes: [...row.modes].sort(),
        aliases: [...row.aliases].sort(),
        category:
          [...row.categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "OTHER",
        confidence,
        // Classified from the final canonical label (not per-transaction) so the badge shown
        // always matches the label actually displayed for this group.
        partyType: classifyPartyType(row.party, confidence),
      };
    })
    .sort((a, b) => {
      if (b.txnCount !== a.txnCount) return b.txnCount - a.txnCount;
      return b.credit + b.debit - (a.credit + a.debit);
    });

  return { summary: summaryRows, byParty };
}

export function groupTransactionsByParty(transactions: SummaryTxn[]): Map<string, SummaryTxn[]> {
  return buildPartyLedger(transactions).byParty;
}

export function buildTransactionSummary(transactions: SummaryTxn[]): TransactionSummaryRow[] {
  return buildPartyLedger(transactions).summary;
}
