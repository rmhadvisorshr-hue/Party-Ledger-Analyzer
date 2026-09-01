// @ts-nocheck
import fs from "node:fs";

let pdfjsPromise;

function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsPromise;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clusterTextItems(items) {
  const clusters = [];
  const tolerance = 3;

  for (const item of items) {
    const text = normalizeText(item.str);
    if (!text) continue;

    const x = item.transform[4];
    const y = item.transform[5];
    let cluster = clusters.find((entry) => Math.abs(entry.y - y) <= tolerance);

    if (!cluster) {
      cluster = { y, items: [] };
      clusters.push(cluster);
    }

    cluster.items.push({ x, text });
    cluster.y = (cluster.y * (cluster.items.length - 1) + y) / cluster.items.length;
  }

  return clusters
    .sort((a, b) => b.y - a.y)
    .map((cluster) => {
      const text = cluster.items
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join(" ");

      return {
        y: cluster.y,
        text: normalizeText(text),
        items: cluster.items,
      };
    })
    .filter((line) => line.text);
}

function mapPasswordError(error) {
  if (error?.name !== "PasswordException") return null;

  const message = String(error.message || "").toLowerCase();
  if (message.includes("incorrect")) {
    return {
      code: "INVALID_PASSWORD",
      message: "The PDF password is incorrect.",
    };
  }

  return {
    code: "PASSWORD_REQUIRED",
    message: "This PDF is password protected. Please provide its password.",
  };
}

async function extractPdf(filePath, password) {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(fs.readFileSync(filePath));

  let pdf;
  try {
    pdf = await pdfjs.getDocument({
      data,
      password: password || undefined,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    }).promise;
  } catch (error) {
    const passwordError = mapPasswordError(error);
    if (passwordError) {
      const mapped = new Error(passwordError.message);
      mapped.code = passwordError.code;
      throw mapped;
    }

    throw error;
  }

  const pages = [];
  const lines = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageLines = clusterTextItems(textContent.items).map((line) => ({
      pageNumber,
      ...line,
    }));

    pages.push({ pageNumber, lines: pageLines });
    lines.push(...pageLines);
  }

  return {
    pageCount: pdf.numPages,
    pages,
    lines,
    text: lines.map((line) => line.text).join("\n"),
  };
}

export { extractPdf };
