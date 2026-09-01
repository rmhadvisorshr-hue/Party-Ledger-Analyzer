import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker } from "tesseract.js";
import { createCanvas } from "@napi-rs/canvas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESSERACT_CACHE_DIR = path.resolve(__dirname, "..", "..", "data", "tesseract-cache");

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".tif", ".tiff"]);

// Scanned/photocopied statements vary wildly in physical page size (some PDFs
// declare a tiny MediaBox -- a few inches -- while packing a full-resolution
// scan into it), so a fixed render scale either blurs dense small print or
// blows up memory on normal-sized pages. Scaling relative to each page's own
// point size keeps the rendered DPI consistent either way.
//
// The target is intentionally higher than a "normal" scan needs: for a
// typical A4-ish page this number only matters up to where
// MAX_RENDER_DIMENSION_PX caps it (a ~595x842pt A4 page already hits that
// cap well below this DPI, so raising the target here doesn't change
// anything for those pages). It exists for the opposite case -- a PDF like
// a phone-scanned passbook page that declares a tiny MediaBox (a couple of
// inches) while embedding an image scanned at 1000+ DPI. The old lower
// target rendered that case at under half the source image's real
// resolution before OCR ever saw it (dense small print + table rulings
// turning to noise), which silently produced garbage text instead of an
// error -- there was nothing to signal that the render itself was the
// problem rather than the OCR engine. Raising the target lets the
// point-size-relative scale climb until MAX_RENDER_DIMENSION_PX reins it
// in, so small-declared-page scans get rendered close to their native
// resolution instead of being needlessly downsampled first.
const FINAL_TARGET_DPI = 1200;
const MAX_RENDER_DIMENSION_PX = 4200;

// Photocopied statements sometimes have individual pages inserted upside
// down. Orientation is picked with a cheap probe render in both directions,
// then only the winning orientation gets the expensive full-resolution pass.
// On a dense/degraded table a probe can be too low-fidelity for *either*
// orientation to produce a recognizable date -- if so both score 0 and the
// date-count signal alone can't tell them apart, so raw OCR confidence
// breaks the tie instead of silently defaulting to upright.
//
// That confidence tie-break is NOT reliably biased toward the true
// orientation, though -- measured directly against a page from a real dense
// scanned table, a 220 DPI probe scored the *wrong* (upside-down)
// orientation higher (28 vs 22) purely from noise, because neither render
// was legible enough at that resolution for confidence to mean anything.
// Raising the probe past ~350 DPI for this same page reliably let
// confidence favor the correct orientation (30-32 vs 21-22) instead, so the
// probe needs real headroom above that, not just "cheaper than the final
// pass" -- a probe that's too cheap to be a meaningful signal is worse than
// no probe, since it still overrides the fallback with confident-looking
// noise.
const ORIENTATION_PROBE_DPI = 500;
const DATE_LIKE_PATTERN = /\b\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\b/g;

function countDateLikeTokens(lines) {
  const text = lines.map((line) => line.text).join(" ");
  return (text.match(DATE_LIKE_PATTERN) || []).length;
}

function orientationScore(result) {
  return countDateLikeTokens(result.lines) * 1000 + result.confidence;
}

let pdfjsPromise;
function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsPromise;
}

// A worker cached for the life of the process (the original approach) lets a
// long-running server slowly accumulate memory across every analysis it ever
// handles. On a memory-constrained shared host that accumulation is what
// eventually gets the whole process OOM-killed -- not just this request, every
// request in flight at that moment. Spinning up a fresh worker per file and
// always terminating it (see extractScannedFile's finally block) bounds this
// pipeline's memory to one file at a time instead of the process's uptime.
function createOcrWorker() {
  fsSync.mkdirSync(TESSERACT_CACHE_DIR, { recursive: true });
  return createWorker("eng", undefined, { cachePath: TESSERACT_CACHE_DIR });
}

// This module does the heaviest CPU/memory work in the app -- multi-pass,
// near-full-resolution canvas rendering plus OCR, per page. Two of these
// running at once on a small shared host is enough to stack their peak memory
// past the container limit, so every call is serialized through this queue
// rather than letting concurrent uploads (or a digital-PDF-parse-then-OCR-
// fallback landing mid-way through another file's OCR) run simultaneously.
let ocrQueue = Promise.resolve();
function withOcrLock(task) {
  const run = ocrQueue.then(task, task);
  ocrQueue = run.then(
    () => {},
    () => {},
  );
  return run;
}

// A pathological scanned PDF (a full lever-arch file scanned as one document,
// say) can have enough pages that even a well-behaved per-page cost adds up to
// more memory/CPU than the host has, taking the whole shared container down
// with it. Reject those up front with a clear, actionable error instead of
// attempting them and crashing every other in-flight request too.
const MAX_OCR_PAGES = Number(process.env.OCR_MAX_PAGES) || 40;

const NBSP_PATTERN = new RegExp(String.fromCharCode(0xa0), "g");
const SINGLE_QUOTE_PATTERN = new RegExp("[" + String.fromCharCode(0x2018) + String.fromCharCode(0x2019) + "]", "g");
const DOUBLE_QUOTE_PATTERN = new RegExp("[" + String.fromCharCode(0x201c) + String.fromCharCode(0x201d) + "]", "g");

function normalizeText(value) {
  return String(value || "")
    .replace(NBSP_PATTERN, " ")
    .replace(SINGLE_QUOTE_PATTERN, "'")
    .replace(DOUBLE_QUOTE_PATTERN, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function linesFromTesseractPage(pageData, pageNumber) {
  const rawLines = [];

  for (const block of pageData.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const items = (line.words || [])
          .map((word) => ({ x: word.bbox.x0, text: normalizeText(word.text) }))
          .filter((item) => item.text);
        const text = normalizeText(items.map((item) => item.text).join(" "));
        if (!text) continue;

        rawLines.push({ y: line.bbox?.y0 ?? 0, pageNumber, text, items });
      }
    }
  }

  // `y` is kept on the returned line (previously stripped here) so that
  // downstream bank-specific parsers can reconstruct table rows by vertical
  // proximity when a dense/annotated scan makes Tesseract split one physical
  // row's date, narration and amount columns across several of these "line"
  // objects instead of recognizing them as one line.
  return rawLines.sort((a, b) => a.y - b.y);
}

function scaleForTargetDpi(pdfPage, targetDpi) {
  const basePoints = pdfPage.getViewport({ scale: 1 });
  const scale = targetDpi / 72;
  const longestSidePx = Math.max(basePoints.width, basePoints.height) * scale;

  if (longestSidePx > MAX_RENDER_DIMENSION_PX) {
    return MAX_RENDER_DIMENSION_PX / Math.max(basePoints.width, basePoints.height);
  }

  return scale;
}

// Photocopied/hand-audited statements often have pen ticks, circles and
// initials marked directly over (or right next to) the printed figures.
// Those marks are reliably blue/colored ink against black printed text on
// a white background, so they can be told apart from real content by
// saturation + blue-channel bias alone, independent of what the document
// says. Measured directly against a page with heavy pen annotation, this
// took Tesseract from misreading a real "37,000.00 / 46,594.81" pair as
// unrecoverable noise to reading it correctly -- the annotations were
// fragmenting the OCR engine's line/word segmentation, not just adding
// stray characters. Real black print (near-zero saturation) is untouched,
// so this is safe on documents with no annotations at all: it just
// binarizes them a little more aggressively, a standard, safe step for
// black-text-on-white financial documents.
function suppressColoredInkAndBinarize(context, width, height) {
  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    const isColoredInk = saturation > 25 && b > r + 15;

    if (isColoredInk) {
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
    } else {
      const gray = (r + g + b) / 3 < 170 ? 0 : 255;
      pixels[i] = gray;
      pixels[i + 1] = gray;
      pixels[i + 2] = gray;
    }
  }

  context.putImageData(imageData, 0, 0);
}

async function renderPdfPageToBuffer(pdfPage, scale, extraRotation = 0) {
  const rotation = (pdfPage.rotate + extraRotation + 360) % 360;
  const viewport = pdfPage.getViewport({ scale, rotation });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");

  await pdfPage.render({ canvasContext: context, viewport }).promise;
  suppressColoredInkAndBinarize(context, canvas.width, canvas.height);
  return canvas.toBuffer("image/png");
}

async function recognizePage(worker, imageInput, pageNumber) {
  const { data } = await worker.recognize(imageInput, {}, { text: true, blocks: true });
  return {
    lines: linesFromTesseractPage(data, pageNumber),
    confidence: typeof data.confidence === "number" ? data.confidence : 0,
  };
}

async function pickOrientation(worker, pdfPage, pageNumber) {
  const probeScale = scaleForTargetDpi(pdfPage, ORIENTATION_PROBE_DPI);

  const uprightBuffer = await renderPdfPageToBuffer(pdfPage, probeScale, 0);
  const upright = await recognizePage(worker, uprightBuffer, pageNumber);

  const flippedBuffer = await renderPdfPageToBuffer(pdfPage, probeScale, 180);
  const flipped = await recognizePage(worker, flippedBuffer, pageNumber);

  return orientationScore(flipped) > orientationScore(upright) ? 180 : 0;
}

async function recognizePdfPageWithFallback(worker, pdfPage, pageNumber) {
  const rotation = await pickOrientation(worker, pdfPage, pageNumber);
  const finalScale = scaleForTargetDpi(pdfPage, FINAL_TARGET_DPI);
  const buffer = await renderPdfPageToBuffer(pdfPage, finalScale, rotation);
  const result = await recognizePage(worker, buffer, pageNumber);
  return result.lines;
}

async function extractScannedFile(filePath) {
  return withOcrLock(() => extractScannedFileExclusive(filePath));
}

async function extractScannedFileExclusive(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const worker = await createOcrWorker();

  const pages = [];
  const lines = [];

  try {
    if (ext === ".pdf") {
      const pdfjs = await getPdfjs();
      const data = new Uint8Array(await fs.readFile(filePath));
      const pdf = await pdfjs.getDocument({
        data,
        verbosity: pdfjs.VerbosityLevel.ERRORS,
      }).promise;

      if (pdf.numPages > MAX_OCR_PAGES) {
        const error = new Error(
          `This scanned file has ${pdf.numPages} pages, which is over the ${MAX_OCR_PAGES}-page OCR limit on this server. Split it into smaller files and upload them separately.`,
        );
        error.code = "OCR_TOO_MANY_PAGES";
        throw error;
      }

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const pdfPage = await pdf.getPage(pageNumber);
        const pageLines = await recognizePdfPageWithFallback(worker, pdfPage, pageNumber);
        pages.push({ pageNumber, lines: pageLines });
        lines.push(...pageLines);
      }
    } else if (IMAGE_EXTENSIONS.has(ext)) {
      const buffer = await fs.readFile(filePath);
      const { lines: pageLines } = await recognizePage(worker, buffer, 1);
      pages.push({ pageNumber: 1, lines: pageLines });
      lines.push(...pageLines);
    } else {
      const error = new Error(`Unsupported file type for OCR: ${ext}`);
      error.code = "OCR_UNSUPPORTED_FILE";
      throw error;
    }
  } catch (error) {
    if (!error.code) error.code = "OCR_FAILED";
    throw error;
  } finally {
    await worker.terminate().catch(() => {});
  }

  if (lines.length === 0) {
    const error = new Error("No text could be recognized in this file.");
    error.code = "OCR_NO_RESULTS";
    throw error;
  }

  return {
    pageCount: pages.length,
    pages,
    lines,
    text: lines.map((line) => line.text).join("\n"),
  };
}

export { extractScannedFile };
