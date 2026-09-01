// @ts-nocheck
const path = require("path");
const { convertPdfToExcelFile } = require("./converter");

async function main() {
  const [, , inputPath, outputPath, password] = process.argv;

  if (!inputPath || !outputPath) {
    console.error("Usage: node src/cli.js <input.pdf> <output.xlsx> [password]");
    process.exit(1);
  }

  const statement = await convertPdfToExcelFile(
    path.resolve(inputPath),
    path.resolve(outputPath),
    { password }
  );

  console.log(`Converted ${statement.transactions.length} transactions.`);
  console.log(`Saved: ${path.resolve(outputPath)}`);
}

main().catch((error) => {
  console.error(error.code ? `${error.code}: ${error.message}` : error);
  process.exit(1);
});
