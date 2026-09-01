import type { TransactionDirection } from "./types";

export function cleanNarration(value: string): string {
  let cleaned = value.replace(/\s+/g, " ").replace(/[|]+/g, " ").trim();

  const patternsToStrip = [
    /STATEMENT PERIOD\s*:\s*\d{4}[-/]\d{2}[-/]\d{2}(?:\s+TO\s+\d{4}[-/]\d{2}[-/]\d{2})?/i,
    /STATEMENT PERIOD\s*:\s*\d{2}[-/]\d{2}[-/]\d{2,4}(?:\s+TO\s+\d{2}[-/]\d{2}[-/]\d{2,4})?/i,
    /OPENING BALANCE\s+TOTAL DEBIT\s+TOTAL CREDIT\s+CLOSING BALANCE\s*[\d,.\s-]*/i,
    /TOTAL DEBIT\s+TOTAL CREDIT\s+CLOSING BALANCE\s*[\d,.\s-]*/i,
    /TRANSACTION VALUE DATE PARTICULARS CHEQUE DEBIT CREDIT BALANCE DATE NO/i,
    /TRANSACTION VALUE DATE PARTICULARS/i,
    /CHEQUE DEBIT CREDIT BALANCE DATE NO/i,
    /VALUE DATE PARTICULARS CHEQUE DEBIT CREDIT BALANCE/i,
    /Opening Balance Total Debit Total Credit Closing Balance\s*[\d,.\s-]*/i,
    /Opening Balance Total Total Closing Balance\s*[\d,.\s-]*/i,
    /Transaction Value Date Particulars Cheque Debit Credit Balance Date No/i,
    /Value Date Particulars Cheque Debit Credit Balance/i,
    /\bValue Da\b/i
  ];

  for (const pattern of patternsToStrip) {
    cleaned = cleaned.replace(pattern, "");
  }

  return cleaned.replace(/\s+/g, " ").trim();
}

export function classifyMode(narration: string): string {
  const text = narration.toUpperCase();
  if (/\bUPI\b/.test(text)) return "UPI";
  if (/\bRTGS\b/.test(text)) return "RTGS";
  if (/\bNEFT\b/.test(text)) return "NEFT";
  if (/\bIMPS\b/.test(text)) return "IMPS";
  if (/\bECS\b|\bNACH\b|\bACH\b/.test(text)) return "ECS/NACH";
  if (/\bATM\b/.test(text)) return "ATM";
  if (/\bCASH\b/.test(text)) return "CASH";
  if (/\bCHQ\b|\bCHEQUE\b|\bCLG\b/.test(text)) return "CHEQUE";
  return "OTHER";
}

export function classifyCategory(narration: string, direction: TransactionDirection): string {
  const text = narration.toUpperCase();
  if (/\bSALARY\b|\bPAYROLL\b|\bWAGES\b/.test(text)) return "Salary";
  if (/\bEMI\b|\bLOAN\b|\bFINANCE\b|\bNACH\b|\bECS\b/.test(text)) return "Loan & EMI";
  if (/\bGST\b|\bTDS\b|\bTAX\b|\bPF\b|\bESIC\b/.test(text)) return "Statutory";
  if (/\bELECTRIC|POWER|MSEB|UTILITY|GAS|WATER|BILL\b|AIRTEL|JIO|VODAFONE/.test(text)) return "Utilities";
  if (/\bRENT\b|\bLEASE\b/.test(text)) return "Rent";
  if (/\bCASH\b/.test(text)) return direction === "Credit" ? "Cash Deposit" : "Cash Withdrawal";
  if (/\bCHARGE\b|\bPENAL\b|\bBOUNCE\b|\bRETURN\b|\bINSUFFICIENT\b/.test(text)) return "Bank Charges";
  if (/\bUPI\b|\bPOS\b|\bCARD\b/.test(text)) return "Digital Payments";
  return direction === "Credit" ? "Trade Credit" : "Trade Debit";
}

/**
 * Bank-statement boilerplate that sometimes gets glued onto (or trails) the real narration:
 * closing-balance footers, registered-office/CIN/toll-free blurbs, fraud-warning notices.
 * These are never a counterparty, so we cut them out of the text *before* party extraction
 * runs, instead of only using them to reject a whole narration outright — the real name is
 * often still sitting right in front of one of these phrases (e.g. "MRS HEMLATA SHASHIKANT
 * *Closing balance includes funds earmarked for hold...").
 */
const BOILERPLATE_PHRASE_PATTERNS: RegExp[] = [
  /\*?\s*CLOSING\s+BALANCE\s+INCLUDES\s+FUNDS\s+EARMARKED[^.]*\.?/i,
  /\bAVAILABLE\s+BALANCE\s+INCLUDES?\b.*/i,
  /\bEARMARKED\s+FOR\s+HOLD\b.*/i,
  /\bREGD\.?\s+OFFICE\b.*/i,
  /\bREGISTERED\s+OFFICE\b.*/i,
  /\bCORPORATE\s+OFFICE\b.*/i,
  /\bTOLL[\s-]?FREE\b.*/i,
  /\b24\s*X\s*7\b.*/i,
  /\bHELPLINE\b.*/i,
  /\bCUSTOMER\s*I\.?D\.?\s*[:-]?\s*[A-Z0-9]*/i,
  /\bCIN\s*(?:NO)?\s*[:-]?\s*[A-Z0-9]+/i,
  /\bIFSC\s*CODE\s*[:-]?\s*[A-Z0-9]*/i,
  /\bBANK\s+REFERENCE\s+NO\s*[:-]?\s*[A-Z0-9]*/i,
  /\bWWW\.[A-Z0-9.-]+/i,
  /\b1800[\d-]{6,}/,
  /\bIF\s+NOT\s+DONE\s+BY\s+YOU\b.*/i,
  /\bYOU\s+ARE\s+ADVISED\b.*/i,
  /\bPLEASE\s+CONTACT\b.*/i,
  /\bKINDLY\s+CONTACT\b.*/i,
  /\bDEAR\s+CUSTOMER\b.*/i,
  // Some statement exports leak an entire mini table-header/report block into a single
  // transaction's narration (a PDF-table-parsing artifact, not real narration text).
  /\bCUSTOMER\s+ACCOUNT\s+LEDGER\s+REPORT\b.*/i,
  /\bSERVICE\s+OUT\s*LET\b.*/i,
  /\bGL\.?\s+SUB\s+HEAD\s+CODE\b.*/i,
  /\bTRANSACTION\s+VALUE\s+DATE\s+PARTICULARS\b.*/i,
];

export function stripBoilerplate(value: string): string {
  let cleaned = value;
  for (const pattern of BOILERPLATE_PHRASE_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

/**
 * Tokens that only ever describe the payment channel, card network, or a banking process --
 * never the counterparty itself. Shared by the pattern-based extractor here and the
 * fallback tokenizer in entityResolution.ts so both pipelines agree on what is noise.
 */
export const CHANNEL_NOISE_WORDS = new Set([
  "UPI", "IMPS", "NEFT", "RTGS", "ACH", "NACH", "ECS", "SI", "BIL", "POS", "ATM",
  "CHQ", "CHEQUE", "CLG", "CARD", "AUTOPAY", "CASH", "SWEEP", "TRF", "TRANSFER", "TPT",
  "MOB", "MB", "MBK", "IB", "INB", "IBK", "INET", "INTERNET", "MOBILE", "EBANK", "WIB",
  "TPFT", "P2A", "P2M", "P2P", "P2I", "I2I", "A2A", "INTENT", "UPIINTENT", "COLLECT",
  "REQPAY", "PAY", "PAYMENT", "FUND", "FUNDS", "VISA", "MASTERCARD", "RUPAY", "MAESTRO",
  "POI", "ECOM", "REV", "REVERSAL", "REF", "TXN", "UTR", "RRN", "ID", "NO", "TM", "NP",
  "DR", "CR", "NA", "NIL", "TO", "FROM", "BY", "WDL", "DECL", "ISF", "NFS", "CASA",
  "EDC", "DEP", "REC", "CHRG", "CHG", "RTN", "OPM", "BKD", "FD", "XFER", "PURCHASE",
  "SALE", "RETAIL",
  // Common UPI PSP/bank handle suffixes -- normally already dropped by stripVpaSuffix, kept
  // here as a defensive backstop for any raw text that reaches the tokenizer un-stripped.
  "YBL", "OKAXIS", "OKHDFCBANK", "OKSBI", "OKICICI", "IBL", "PTYS", "AXL", "APL",
  "OKBIZAXIS", "PTAXIS", "YAPL", "WAAXIS", "JIO",
]);

/**
 * Single words that only show up in banking process / boilerplate messages -- return
 * advices, bounce notices, charge narrations, form-letter phrases -- never a real party
 * name by themselves.
 */
export const PROCESS_NOISE_WORDS = new Set([
  "RECEIVED", "ADVICE", "REJECT", "REJECTED", "RETURN", "RETURNED", "BOUNCE", "BOUNCED",
  "INSUFFICIENT", "INSUFFICENT", "REGD", "OFFICE", "REGISTERED", "CORPORATE",
  "CUSTOMERID", "CUSTOMER", "CUST", "CIN", "GSTIN", "IFSC", "HELPLINE", "TOLLFREE", "CONTACT",
  "WEF", "DATED", "VALUE", "ACCOUNT", "NUMBER", "BRANCH", "ADVISED", "KINDLY", "PLEASE",
  "NOTE", "NOTED", "DEAR", "CLOSING", "BALANCE", "EARMARKED", "HOLD", "AVAILABLE",
  "INCLUDES", "OPEN", "DATE", "PORD", "CHGS", "CHARGE", "CHARGES", "FEE", "FEES",
  "PENAL", "PENALTY", "PORTAL", "GENERATED", "AUTO", "SYSTEM", "ENTRY", "MISC",
  "PAID", "ITD", "YBS", "EBA", "SERVICE", "OUTLET", "LEDGER", "REPORT", "NOT", "FOR",
  // Address/statement-metadata words that show up in leaked customer/branch-info blobs --
  // never a counterparty, but structurally indistinguishable from a proper noun otherwise.
  "PHONE", "LIMIT", "CURRENCY", "UNCLEARED", "PREFERRED", "STATEMENT", "OTHER",
]);

/**
 * Common English sentence words that show up when a whole boilerplate *sentence* (rather
 * than a single stray word) leaks into a narration field, e.g. "YOU ARE ADVISED THAT...".
 * Used by looksLikeBoilerplateSentence to reject the whole span rather than mining a
 * fragment like "YOU ARE" out of it.
 */
const SENTENCE_FILLER_WORDS = new Set([
  "YOU", "ARE", "IS", "WAS", "WERE", "THE", "THIS", "THAT", "HAVE", "HAS", "WILL",
  "YOUR", "NOT", "BEEN", "BE", "IT", "IF", "IN", "ON", "OF", "AS", "AT", "DO", "DID",
]);

function isPureChannelOrProcessWord(upperToken: string): boolean {
  return CHANNEL_NOISE_WORDS.has(upperToken) || PROCESS_NOISE_WORDS.has(upperToken);
}

/** True when a run of tokens reads like a form-letter sentence rather than a name/entity. */
export function looksLikeBoilerplateSentence(text: string): boolean {
  const tokens = text.toUpperCase().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return false;
  const fillerCount = tokens.filter((t) => SENTENCE_FILLER_WORDS.has(t)).length;
  return fillerCount / tokens.length >= 0.4;
}

/**
 * "pradeepparmar8983", "julshadkhannpathan82" -- a UPI handle is frequently a name with a
 * few disambiguating digits glued on with no separator. Strip a short trailing digit run so
 * the name underneath survives instead of the whole token being discarded as "looks like a
 * reference code".
 */
export function stripTrailingDigitSuffix(token: string): string {
  const match = token.match(/^([A-Za-z][A-Za-z]{3,})\d{1,4}$/);
  return match ? match[1] : token;
}

/**
 * "dineshjogle086-5@ybl food" -> "dineshjogle086-5 food" -- drops the "@<psp/bank code>"
 * portion of a UPI VPA entirely instead of turning '@' into a space, which used to let the
 * PSP suffix (ybl, okaxis, ptys, ...) survive tokenizing as if it were a real word.
 */
export function stripVpaSuffix(text: string): string {
  return text.replace(/@[A-Za-z0-9.]+/g, " ");
}

export function isReferenceCodeShape(upperToken: string): boolean {
  // Pure digits of any real length (dates/times split into fragments, UTR/ref numbers).
  if (/^\d+$/.test(upperToken)) return upperToken.length >= 2;
  // hh:mm(:ss) or dd/mm/yy(yy) or dd-mm-yy(yy).
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(upperToken)) return true;
  if (/^\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$/.test(upperToken)) return true;
  if (/^(19|20)\d{2}$/.test(upperToken)) return true;
  // IFSC-shaped codes: 4 letters + 0 + alphanumeric (HDFC0001234, YESB0000123).
  if (/^[A-Z]{4}0[A-Z0-9]{4,}$/.test(upperToken)) return true;
  // Short letter-prefix + digits reference codes: R3922, TO13431, S52516184, WW8951, REP31.
  if (/^[A-Z]{1,4}\d{2,}$/.test(upperToken)) return true;
  // Month-abbreviation + 2-digit-year tags: JAN25, APR25, DEC26 (statement-period markers).
  if (/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2}$/.test(upperToken)) return true;
  // Long alphanumeric codes that are clearly not a pronounceable word -- require an actual
  // digit to be present so pure words (SETTLEMENT, VISUALMITRA, ENTERPRISES, COMMODITIES)
  // are never rejected just for being long.
  if (upperToken.length >= 10 && /\d/.test(upperToken) && /^[A-Z0-9]+$/.test(upperToken)) return true;
  return false;
}

export function isLikelyPartyToken(token: string): boolean {
  if (!token) return false;
  if (!/[A-Za-z0-9]/.test(token)) return false;
  const upper = token.toUpperCase();
  if (isPureChannelOrProcessWord(upper)) return false;
  if (isReferenceCodeShape(upper)) return false;
  if (/^XX+\d*$/i.test(token)) return false;
  return token.length >= 3;
}

/** Labels that are only ever meaningful as a joiner between two real name tokens -- never
 * acceptable as the entire extracted party by themselves (e.g. "J AND K" losing both real
 * tokens to the length gate should fall through to UNRECOGNIZED, not surface as "AND"). */
const CONNECTOR_ONLY = new Set(["AND", "OR", "THE", "OF", "&"]);

/**
 * No real Indian person/business name in this domain runs past ~6 words. A candidate that
 * still has more tokens than this after noise-filtering is not a name that slipped through a
 * few unfiltered words -- it's a paragraph (address block, leaked customer-info blob,
 * statement fragment) that happens to contain mostly proper-noun-shaped words, which is
 * exactly the class of noise-word/filler-ratio heuristics above cannot see. Reject it outright
 * rather than truncating it to a shorter *slice* of the same paragraph.
 */
export const MAX_PARTY_WORDS = 6;

/** Strips leading/trailing punctuation a token can pick up from narration text ("NO.",
 * "STATEMENT.") before it's checked against the noise-word sets, which key on exact strings. */
export function trimTokenPunctuation(token: string): string {
  return token.replace(/^[.,;:]+/, "").replace(/[.,;:]+$/, "");
}

function pickBestPartyCandidate(candidates: string[]): string | null {
  const cleaned = candidates
    .map((value) => cleanNarration(value).replace(/[^A-Za-z0-9 .&()/-]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const candidate of cleaned) {
    if (looksLikeBoilerplateSentence(candidate)) continue;
    const tokens = candidate
      .split(/\s+/)
      .map((t) => trimTokenPunctuation(t))
      .map((t) => stripTrailingDigitSuffix(t))
      .filter(isLikelyPartyToken);
    if (tokens.length === 0) continue;
    if (tokens.length > MAX_PARTY_WORDS) continue;
    if (tokens.every((t) => CONNECTOR_ONLY.has(t.toUpperCase()))) continue;
    const label = tokens.join(" ");
    if (label.length >= 3) return label.slice(0, 80);
  }

  return null;
}

/** Splits a cleaned narration into candidate segments along its field separators. A "-" is
 * only treated as a field separator outside of a VPA span (name-tag@bank): splitting those
 * on "-" too would tear the tag digits away from the handle before extractVpaSpan can drop
 * them as a unit. */
function splitIntoSegments(text: string): string[] {
  return text
    .split(/[/|]+/)
    .flatMap((part) => (part.includes("@") ? [part] : part.split(/-+/)))
    .map((part) => part.trim())
    .filter(Boolean);
}

/** "dineshjogle086-5@ok" -> "dineshjogle086-5" (drop the @-suffix bank/PSP code entirely --
 * it is never the counterparty, and letting it fall through to the tokenizer is how PSP
 * suffixes like "ybl"/"axl"/"ptys" used to leak out as fake party names). */
function segmentUsableText(segment: string): string {
  if (!segment.includes("@")) return segment;
  return segment.split("@")[0];
}

function scoreSegmentCandidate(label: string, segmentIndex: number): number {
  const tokens = label.split(/\s+/).filter(Boolean);
  let score = tokens.length * 10 + Math.min(label.length, 20);
  if (tokens.length === 1 && tokens[0].length <= 3) score -= 15;
  // Earlier segments are weighted fairly heavily: "TYPE-CODE-NAME-BANK-ACCT-ITEM" narrations
  // put the counterparty a couple of fields in and an item/product description at the tail,
  // which can otherwise outscore the real name purely on word count.
  score -= segmentIndex * 3;
  return score;
}

export function extractParty(narration: string): string {
  const text = stripBoilerplate(cleanNarration(narration));
  if (!text) return "";

  const segments = splitIntoSegments(text);

  // Score every segment's best candidate and keep the strongest one, rather than the first
  // that parses: bank-formatted narrations mix "TYPE-CODE-PURPOSE-NAME" and
  // "TYPE-CODE-NAME-REFERENCE" shapes in the wild, so position alone isn't reliable --
  // a multi-word name should always beat a lone 3-letter code, wherever it sits.
  let best: { label: string; score: number } | null = null;
  segments.forEach((segment, index) => {
    const picked = pickBestPartyCandidate([segmentUsableText(segment)]);
    if (!picked) return;
    const score = scoreSegmentCandidate(picked, index);
    if (!best || score > best.score) best = { label: picked, score };
  });
  if (best) return (best as { label: string; score: number }).label;

  // Nothing segment-level worked (e.g. no clean delimiters at all) -- fall back to scanning
  // every word in the full text for anything name-shaped. Reject rather than truncate when
  // too many tokens survive: taking "the first 4 words" of a long, delimiter-free blob is
  // just a different-shaped truncation of the same paragraph, not a real candidate.
  if (!looksLikeBoilerplateSentence(text)) {
    const words = text
      .toUpperCase()
      .split(/\s+/)
      .map((t) => trimTokenPunctuation(t))
      .map((t) => stripTrailingDigitSuffix(t))
      .filter(isLikelyPartyToken);
    if (words.length > 0 && words.length <= MAX_PARTY_WORDS) return words.join(" ").slice(0, 80);
  }

  return "";
}
