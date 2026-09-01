import { convertPdfToStatement } from "../src/converter/converter.ts";
import { extractPdf } from "../../../BankStatementconvertermain/src/lib/bankstatement-backend/pdfExtractor.js";

const pdf = process.argv[2] || "D:/Data/ai-bankconverter/normal data/ICICI 0893.pdf";

const extraction = await extractPdf(pdf);
console.log("lines sample:");
extraction.lines.slice(0, 30).forEach((line, i) => console.log(i, line.text));

const statement = await convertPdfToStatement(pdf);
console.log("\ncount:", statement.transactions.length);
statement.transactions.forEach((t, i) => {
  console.log(
    i + 1,
    t.date.toISOString().slice(0, 10),
    "W:", t.withdrawal,
    "D:", t.deposit,
    "Bal:", t.balance,
    t.particulars.slice(0, 70),
  );
});
