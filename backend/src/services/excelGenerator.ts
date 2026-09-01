import ExcelJS from 'exceljs';
import { AnalysisReport } from '../analysis/types';
import {
  buildPartyLedger,
  extractPartyLedgerFields,
  groupTransactionsByParty,
} from '../analysis/transactionSummary';
import {
  applyConsistentSheetFormatting,
  EXCEL_THEME,
  INR_NUM_FMT,
  styleIndexSheet,
} from './excelSheetStyles';
import { prepareSheetRowsWithSectionNav } from './excelSectionNav';

type RawSheetRows = Array<Array<string | number | null>>;

const INDEX_SHEET_DESCRIPTIONS: Record<string, string> = {
  Flags: "Flagging of critical events which affect credit decisioning",
  "Exec Summary": "A concise and holistic Performance overview",
  "CAM Analysis": "Monthwise overview of key data points",
  "MoM Summary": "Month on month summary of all the metrics",
  "Raw Data": "Raw data as extracted from bank statements",
  "Monthly CF": "Monthwise details of the Net cash flows",
  "Bounce & Penal": "Details of different types of Bank bounces and charges",
  "Loans and EMI": "Details of instances of loans received and EMIs paid",
  "EMI Tracker": "Monthwise Financial institution wise EMI tracker",
  "Trade Credits": "Partywise details of Trade Credits received",
  "Trade Debits": "Partywise details of Trade Debits paid",
  "Highest Tns": "10 highest debit and credit transactions",
  "Internal & Group": "Internal and related party transaction details",
  Circular: "Circular flow of funds between parties",
  "Net Transactions": "Net debit and credit amounts monthwise",
  Salary: "Salary credits and related analysis",
  "Staff Emoluments": "Salary debits and staff emoluments",
  "Spend Analysis": "Category wise spend analysis",
  "Bill Payments": "Utility and bill payment analysis",
  "Recurring Debit": "Recurring debit patterns",
  "Recurring Credit": "Recurring credit patterns",
  "Transaction Summary": "Party-wise transaction summary",
};

export class ExcelGeneratorService {
  private readonly masterModules = [
    { key: "flags-risk", title: "Flags" },
    { key: "executive-summary", title: "Exec Summary" },
    { key: "cam-analysis", title: "CAM Analysis" },
    { key: "mom-summary", title: "MoM Summary" },
    { key: "raw-data", title: "Raw Data" },
    { key: "monthly-cash-flow", title: "Monthly CF" },
    { key: "bounce-penal", title: "Bounce & Penal" },
    { key: "loans-emi", title: "Loans and EMI" },
    { key: "emi-tracker", title: "EMI Tracker" },
    { key: "trade-credits", title: "Trade Credits" },
    { key: "trade-debits", title: "Trade Debits" },
    { key: "highest-transactions", title: "Highest Tns" },
    { key: "internal-group", title: "Internal & Group" },
    { key: "circular-flows", title: "Circular" },
    { key: "net-transactions", title: "Net Transactions" },
    { key: "salary", title: "Salary" },
    { key: "staff-emoluments", title: "Staff Emoluments" },
    { key: "spend-analysis", title: "Spend Analysis" },
    { key: "bill-payments", title: "Bill Payments" },
    { key: "recurring-debits", title: "Recurring Debit" },
    { key: "recurring-credits", title: "Recurring Credit" },
    { key: "transactions-summary", title: "Transaction Summary" },
  ];

  private readonly sectionTitles = new Set<string>([
    'Month Wise Balance and Transaction Summary',
    'Month Wise Bounce and Charges Summary',
    'Month Wise Loan Payments',
    'Internal & Non-Trade Related Party Transaction',
    'Mode Wise Transactions',
    'Bounce and Charge Summary',
    'Bounce and Charge Instances',
    'Loan Credit Instances',
    'EMI Debit Instances',
    'Interest Servicing Instances',
    'EMI',
    'Party Wise Credits (Rank wise)',
    'Party Wise Debits (Rank wise)',
    '10 Highest Debit Transactions',
    '10 Highest Credit Transactions',
    'Party Wise Internal and Related Party Debits',
    'Party Wise Internal and Related Party Credits',
    'Internal txn instances',
    'Party Wise Debit(Circular)',
    'Party Wise Credit(Circular)',
    'Circular txn instances',
    'Net Debit Amount',
    'Net Credit Amount',
    'Summary of Salary',
    'Salary Credit Instances',
    'Summary of Salary Debited',
    'Salary Debit Instances',
    'Summary of Spend Analysis',
    'Summary of Utility Bill Payments',
    'Executive Summary',
    'Raw Data',
  ]);

  private readonly headerFirstCells = new Set<string>([
    'Particulars',
    'SN',
    'Month-Year',
    'Ranking',
    'DATE',
    'Name of FI',
  ]);

  private createWorkbookFromRawSheet(
    worksheetName: string,
    moduleTitle: string,
    rows: RawSheetRows,
    report?: AnalysisReport,
  ): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(worksheetName, {
      properties: { tabColor: { argb: 'FF1F4E79' } },
    });
    this.renderRawSheet(worksheet, moduleTitle, rows, report);
    return workbook;
  }

  private sheetMeta(report?: AnalysisReport): { client: string; bank: string; period: string } {
    return {
      client: report?.applicant?.name || report?.accountInfo?.accountName || "Client",
      bank: report?.accountInfo?.bank || report?.applicant?.banks?.[0]?.name || "Bank",
      period: report?.applicant?.period ?? "-",
    };
  }

  private buildFallbackRawData(report: AnalysisReport): RawSheetRows {
    const client = report.applicant?.name || "Client";
    const bank = report.applicant?.banks?.[0];
    const subtitle = bank
      ? `Account Number: ${bank.account}, ${bank.name}${bank.ifsc && bank.ifsc !== "-" ? ` (${bank.ifsc})` : ""}`
      : "Consolidated";
    const rows: RawSheetRows = [
      [client, null, null, null, "Index"],
      [subtitle, null, null, null, "Go to top"],
      [],
      ["Raw Data", "Raw Data", "Raw Data"],
      ["SN", "DATE", "Description", "Debit", "Credit", "Balance", "Category"],
    ];
    (report.transactions ?? []).forEach((txn, index) => {
      rows.push([
        index + 1,
        txn.dateText,
        txn.narration,
        txn.debit > 0 ? txn.debit : null,
        txn.credit > 0 ? txn.credit : null,
        txn.balance ?? null,
        txn.category,
      ]);
    });
    return rows;
  }

  private hasProfessionalNavRows(rows: RawSheetRows): boolean {
    return rows.some((row) => row?.includes("Index")) && rows.some((row) => row?.includes("Go to top"));
  }

  private applyNavHyperlinks(worksheet: ExcelJS.Worksheet, sheetName: string): void {
    worksheet.eachRow((row) => {
      let hasNavLabel = false;

      row.eachCell((cell) => {
        if (cell.value === "Index") {
          hasNavLabel = true;
          cell.value = {
            text: "Index",
            hyperlink: "#'Index'!A1",
            tooltip: "Back to index",
          };
          cell.font = { color: { argb: "FF0563C1" }, underline: true, bold: true };
        } else if (cell.value === "Go to top") {
          hasNavLabel = true;
          cell.value = {
            text: "Go to top",
            hyperlink: `#'${sheetName.replace(/'/g, "''")}'!A1`,
            tooltip: "Back to top of sheet",
          };
          cell.font = { color: { argb: "FF0563C1" }, underline: true, bold: true };
        }
      });

      if (hasNavLabel) {
        row.eachCell({ includeEmpty: true }, (cell) => {
          if (!cell.fill) {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFE9EDF5" },
            };
          }
        });
      }
    });
  }

  private renderRawSheet(
    worksheet: ExcelJS.Worksheet,
    moduleTitle: string,
    rows: RawSheetRows,
    report?: AnalysisReport,
  ): void {
    const maxCols = Math.max(...rows.map((row) => row.length), 1);
    const professional = this.hasProfessionalNavRows(rows);

    if (!professional) {
      const headerText = `RMH Advisors Pvt Ltd - ${moduleTitle}`;
      const meta = this.sheetMeta(report);

      worksheet.addRow([headerText]);
      worksheet.mergeCells(1, 1, 1, maxCols);
      const headerCell = worksheet.getCell("A1");
      headerCell.font = { bold: true, size: 14, color: { argb: "FF1F4E79" } };
      headerCell.alignment = { horizontal: "center", vertical: "middle" };
      headerCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE8EEF4" },
      };

      const metaRow = worksheet.addRow([
        `Client: ${meta.client}  |  Bank: ${meta.bank}  |  Period: ${meta.period}`,
      ]);
      worksheet.mergeCells(metaRow.number, 1, metaRow.number, maxCols);
      metaRow.getCell(1).font = { size: 10, italic: true };
      metaRow.getCell(1).alignment = { horizontal: "center" };
      worksheet.addRow([]);
    }

    const rowsWithSectionNav = prepareSheetRowsWithSectionNav(rows);

    rowsWithSectionNav.forEach((row) => {
      worksheet.addRow(row as ExcelJS.CellValue[]);
    });

    applyConsistentSheetFormatting(worksheet);
    this.applyNavHyperlinks(worksheet, worksheet.name);

    worksheet.columns.forEach((column, index) => {
      if (index === 0) column.width = 32;
      else if (index === 1) column.width = 14;
      else if (index === 2) column.width = 42;
      else column.width = 16;
    });

    worksheet.views = [
      { state: "frozen", ySplit: professional ? 3 : 4, activeCell: professional ? "A4" : "A5" },
    ];
  }

  private addDisclaimerSheet(workbook: ExcelJS.Workbook, report: AnalysisReport): void {
    const sheet = workbook.addWorksheet("Disclaimer", {
      properties: { tabColor: { argb: "FF1F4E79" } },
    });
    sheet.addRow([]);
    sheet.addRow([]);
    sheet.addRow([]);
    sheet.addRow(["REPORT NAME:  Party Ledger Analysis Report"]);
    sheet.addRow(["Disclaimer:"]);
    sheet.addRow([
      "RMH Advisors / PLA is a data and information service. This report is generated from bank statement data supplied by the user. It should be used for analysis purposes only and does not constitute financial advice.",
    ]);
    sheet.getCell("A5").font = { bold: true, size: 12 };
    sheet.getCell("A6").font = { bold: true, size: 11 };
    sheet.getCell("A7").alignment = { wrapText: true, vertical: "top" };
    sheet.getColumn(1).width = 100;
  }

  private addIndexSheet(workbook: ExcelJS.Workbook): void {
    const sheet = workbook.addWorksheet("Index", {
      properties: { tabColor: { argb: "FF4F81BD" } },
    });
    sheet.addRow(["Index"]);
    sheet.addRow(["SN", "SHEETS", "DESCRIPTION"]);

    this.masterModules.forEach((module, index) => {
      const row = sheet.addRow([
        index + 1,
        module.title,
        INDEX_SHEET_DESCRIPTIONS[module.title] ?? "Analysis module",
      ]);
      row.getCell(2).value = {
        text: module.title,
        hyperlink: `#'${module.title}'!A1`,
        tooltip: `Open ${module.title}`,
      };
    });

    sheet.getColumn(1).width = 6;
    sheet.getColumn(2).width = 28;
    sheet.getColumn(3).width = 64;
    styleIndexSheet(sheet);
  }

  /**
   * Generate Excel file for Executive Summary module
   */
  async generateExecutiveSummary(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    if (report.execSheet && report.execSheet.length > 0) {
      return this.createWorkbookFromRawSheet('Exec Summary', 'Executive Summary', report.execSheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Exec Summary');

    // Add header
    worksheet.addRow(['RMH Advisors Pvt Ltd - Executive Summary']);
    worksheet.mergeCells('A1:D1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    // Account Information
    worksheet.addRow(['Account Information']);
    worksheet.getCell('A3').font = { bold: true };
    worksheet.addRow(['Account Number', report.accountInfo?.accountNumber || 'N/A']);
    worksheet.addRow(['Account Holder', report.accountInfo?.accountName || 'N/A']);
    worksheet.addRow(['Bank Name', report.accountInfo?.bank || 'N/A']);
    worksheet.addRow(['Statement Period', `${report.statementPeriod?.startDate} to ${report.statementPeriod?.endDate}`]);
    worksheet.addRow([]);

    // Financial Summary
    worksheet.addRow(['Financial Summary']);
    worksheet.getCell('A9').font = { bold: true };
    
    const firstMonth = report.metrics?.[0];
    const lastMonth = report.metrics?.[report.metrics.length - 1];
    const totalCredits = report.metrics?.reduce((sum, m) => sum + m.totalCredits, 0) || 0;
    const totalDebits = report.metrics?.reduce((sum, m) => sum + m.totalDebits, 0) || 0;
    
    worksheet.addRow(['Opening Balance', firstMonth?.openingBal?.toFixed(2) || '0.00']);
    worksheet.addRow(['Closing Balance', lastMonth?.closingBal?.toFixed(2) || '0.00']);
    worksheet.addRow(['Total Credits', totalCredits.toFixed(2)]);
    worksheet.addRow(['Total Debits', totalDebits.toFixed(2)]);
    worksheet.addRow(['Net Cash Flow', (totalCredits - totalDebits).toFixed(2)]);
    worksheet.addRow([]);

    // Transaction Summary
    worksheet.addRow(['Transaction Summary']);
    worksheet.getCell('A16').font = { bold: true };
    const totalCreditCount = report.metrics?.reduce((sum, m) => sum + m.creditCount, 0) || 0;
    const totalDebitCount = report.metrics?.reduce((sum, m) => sum + m.debitCount, 0) || 0;
    worksheet.addRow(['Total Transactions', report.transactions?.length || 0]);
    worksheet.addRow(['Credit Transactions', totalCreditCount]);
    worksheet.addRow(['Debit Transactions', totalDebitCount]);

    // Exec Summary table (Particulars · Consolidated · Bank-wise)
    worksheet.addRow([]);
    const banks = report.applicant?.banks ?? [];
    const bank1 = banks[0];
    const bank2 = banks[1];
    const bank1Label = bank1 ? `${bank1.name} · ${bank1.account}` : '';
    const bank2Label = bank2 ? `${bank2.name} · ${bank2.account}` : '';

    const headerRowValues: string[] = ['Particulars', 'Consolidated'];
    if (bank1) headerRowValues.push(bank1Label);
    if (bank2) headerRowValues.push(bank2Label);
    worksheet.addRow(headerRowValues);
    worksheet.getRow(worksheet.rowCount).font = { bold: true };

    (report.execSummary || []).forEach((row) => {
      const r = row as Record<string, string>;
      const values: (string | number)[] = [r.particulars ?? '', r.consolidated ?? ''];
      if (bank1) values.push(r.kotak ?? '');
      if (bank2) values.push(r.pnb ?? '');
      worksheet.addRow(values);
    });

    // Auto-fit columns
    worksheet.columns.forEach(column => {
      column.width = 25;
    });

    return workbook;
  }

  /**
   * Generate Excel file for Flags & Risk module
   */
  async generateFlagsAndRisk(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    if (report.flagsSheet && report.flagsSheet.length > 0) {
      return this.createWorkbookFromRawSheet('Flags', 'Flags & Risk', report.flagsSheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Flags');

    // Header
    worksheet.addRow(['RMH Advisors Pvt Ltd - Flags & Risk Analysis']);
    worksheet.mergeCells('A1:E1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    // Risk Score Summary (if available)
    if (report.riskScore) {
      worksheet.addRow(['Risk Score Summary']);
      worksheet.getCell('A3').font = { bold: true };
      worksheet.addRow(['Score', report.riskScore.value]);
      worksheet.addRow(['Band', report.riskScore.band]);
      worksheet.addRow(['Decision', report.riskScore.decision]);
      worksheet.addRow(['Confidence', report.riskScore.confidence]);
      worksheet.addRow(['Trend', report.riskScore.trend]);
      worksheet.addRow([]);
    }

    // Risk Flags table (aligned with sample structure)
    const headerRowIndex = worksheet.rowCount + 1;
    worksheet.addRow(['Risk Flags']);
    worksheet.getCell(`A${headerRowIndex}`).font = { bold: true };
    worksheet.addRow(['SN', 'Flag Category', 'Flag', 'Flag Description', 'Flag Colour']);
    worksheet.getRow(worksheet.rowCount).font = { bold: true };

    if (report.flags && report.flags.length > 0) {
      report.flags.forEach((flag) => {
        worksheet.addRow([
          flag.sn,
          flag.category,
          flag.flag,
          flag.description,
          flag.severity,
        ]);
      });
    } else {
      worksheet.addRow(['No flags found']);
    }

    worksheet.columns.forEach((column) => {
      column.width = 24;
    });

    return workbook;
  }

  /**
   * Generate Excel file for Monthly Cash Flow module
   */
  async generateMonthlyCashFlow(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    const cashflowSheet = report.monthlyCFSheet;

    if (cashflowSheet && cashflowSheet.length > 0) {
      return this.createWorkbookFromRawSheet('Monthly CF', 'Monthly Cash Flow', cashflowSheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Monthly CF');
    worksheet.mergeCells('A1:F1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    if (report.monthlyCF && report.monthlyCF.length > 0) {
      worksheet.addRow([
        'Month',
        'Opening Balance',
        'Operating CF',
        'Investing CF',
        'Financing CF',
        'Closing Balance',
      ]);
      worksheet.getRow(3).font = { bold: true };

      report.monthlyCF.forEach((row) => {
        worksheet.addRow([
          row.month,
          row.opening.toFixed(2),
          row.operating.toFixed(2),
          row.investing.toFixed(2),
          row.financing.toFixed(2),
          row.closing.toFixed(2),
        ]);
      });
    } else {
      worksheet.addRow([
        'Month',
        'Opening Balance',
        'Total Credits',
        'Total Debits',
        'Net Cash Flow',
        'Closing Balance',
      ]);
      worksheet.getRow(3).font = { bold: true };

      const rows = report.metrics || [];
      rows.forEach((month) => {
        worksheet.addRow([
          month.month,
          month.openingBal.toFixed(2),
          month.totalCredits.toFixed(2),
          month.totalDebits.toFixed(2),
          month.netFlow.toFixed(2),
          month.closingBal.toFixed(2),
        ]);
      });
    }

    worksheet.columns.forEach((column) => {
      column.width = 18;
    });

    return workbook;
  }

  /**
   * Generate Excel file for Bounce & Penal module
   */
  async generateBounceAndPenal(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    const bounceSheet = report.bounceSheet;

    if (bounceSheet && bounceSheet.length > 0) {
      return this.createWorkbookFromRawSheet('Bounce & Penal', 'Bounce & Penal', bounceSheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Bounce & Penal');
    worksheet.mergeCells('A1:E1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    worksheet.addRow(['Bounced Transactions']);
    worksheet.getCell('A3').font = { bold: true };
    worksheet.addRow(['Date', 'Description', 'Amount', 'Reason', 'Impact']);
    worksheet.getRow(4).font = { bold: true };

    const bounceEvents = report.events?.filter((event) => /bounce|return/i.test(event.type)) || [];
    if (bounceEvents.length > 0) {
      bounceEvents.forEach((event) => {
        worksheet.addRow([
          event.date,
          event.type,
          event.amount?.toFixed(2) || '0.00',
          event.reason || 'Insufficient funds',
          'Negative',
        ]);
      });
    } else {
      worksheet.addRow(['No bounced transactions found']);
    }

    worksheet.addRow([]);

    worksheet.addRow(['Penal Charges']);
    worksheet.getCell(`A${worksheet.rowCount}`).font = { bold: true };
    worksheet.addRow(['Date', 'Description', 'Amount', 'Type', 'Impact']);
    worksheet.getRow(worksheet.rowCount).font = { bold: true };

    const penalEvents = report.events?.filter((event) => /penal|charge|fee/i.test(event.type)) || [];
    if (penalEvents.length > 0) {
      penalEvents.forEach((event) => {
        worksheet.addRow([
          event.date,
          event.type,
          event.amount?.toFixed(2) || '0.00',
          event.reason || 'Penalty',
          'Negative',
        ]);
      });
    } else {
      worksheet.addRow(['No penal charges found']);
    }

    worksheet.columns.forEach((column) => {
      column.width = 20;
    });

    return workbook;
  }

  /**
   * Generate Excel file for Salary module
   */
  async generateSalary(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    if (report.salarySheet && report.salarySheet.length > 0) {
      return this.createWorkbookFromRawSheet('Salary', 'Salary', report.salarySheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Salary');

    // Header
    worksheet.addRow(['RMH Advisors Pvt Ltd - Salary Analysis']);
    worksheet.mergeCells('A1:E1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    // Salary Summary
    worksheet.addRow(['Salary Summary']);
    worksheet.getCell('A3').font = { bold: true };
    const salaryPatterns = report.patterns?.filter((pattern) =>
      /salary/i.test(pattern.name || "") || /salary/i.test(pattern.category || "")
    ) || [];
    const avgSalary = salaryPatterns.length
      ? salaryPatterns.reduce((sum, pattern) => sum + pattern.avgAmount, 0) / salaryPatterns.length
      : 0;
    const lastSalaryDate = salaryPatterns[0]?.lastDate || "N/A";

    worksheet.addRow(['Average Salary', avgSalary ? avgSalary.toFixed(2) : '0.00']);
    worksheet.addRow(['Salary Frequency', salaryPatterns[0]?.frequency || 'N/A']);
    worksheet.addRow(['Last Salary Date', lastSalaryDate]);
    worksheet.addRow([]);

    // Salary Transactions
    worksheet.addRow(['Salary Transactions']);
    worksheet.getCell(`A${worksheet.rowCount}`).font = { bold: true };
    worksheet.addRow(['Date', 'Description', 'Amount', 'Source', 'Status']);
    worksheet.getRow(worksheet.rowCount).font = { bold: true };

    if (salaryPatterns.length > 0) {
      salaryPatterns.forEach(pattern => {
        worksheet.addRow([
          pattern.lastDate,
          pattern.name || 'Salary Credit',
          pattern.avgAmount?.toFixed(2) || '0.00',
          pattern.category || 'Employer',
          'Credited'
        ]);
      });
    } else {
      worksheet.addRow(['No salary transactions found']);
    }

    worksheet.columns.forEach(column => {
      column.width = 20;
    });

    return workbook;
  }

  /**
   * CAM Analysis module
   */
  async generateCamAnalysis(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    const camSheet = report.camSheet;

    if (camSheet && camSheet.length > 0) {
      return this.createWorkbookFromRawSheet('CAM Analysis', 'CAM Analysis', camSheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('CAM Analysis');
    worksheet.mergeCells('A1:K1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    worksheet.addRow([
      'Month',
      'Net Credit Count',
      'Net Credit',
      'Net Debit Count',
      'Net Debit',
      'I/W Return Count',
      'I/W Return Amount',
      'O/W Return Count',
      'O/W Return Amount',
      'ABB',
      'Utilization',
      'Interest Serviced',
    ]);
    worksheet.getRow(3).font = { bold: true };

    (report.camAnalysis || []).forEach((row: any) => {
      const utilizationValue = typeof row.utilization === 'number' ? row.utilization : undefined;
      const intServicedValue = row.intServiced;
      worksheet.addRow([
        row.month,
        row.netCreditCount ?? 0,
        (row.netCredit ?? 0).toFixed?.(2) ?? Number(row.netCredit || 0).toFixed(2),
        row.netDebitCount ?? 0,
        (row.netDebit ?? 0).toFixed?.(2) ?? Number(row.netDebit || 0).toFixed(2),
        row.iwReturnCount ?? 0,
        (row.iwReturn ?? 0).toFixed?.(2) ?? Number(row.iwReturn || 0).toFixed(2),
        row.owReturnCount ?? 0,
        (row.owReturn ?? 0).toFixed?.(2) ?? Number(row.owReturn || 0).toFixed(2),
        (row.abb ?? 0).toFixed?.(2) ?? Number(row.abb || 0).toFixed(2),
        typeof utilizationValue === 'number' ? `${(utilizationValue * 100).toFixed(1)}%` : '',
        intServicedValue == null ? '-' : Number(intServicedValue).toFixed(0),
      ]);
    });

    worksheet.columns.forEach((column) => {
      column.width = 18;
    });

    return workbook;
  }

  /**
   * MoM Summary module
   */
  async generateMomSummary(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    const momSheet = report.momSheet;

    if (momSheet && momSheet.length > 0) {
      return this.createWorkbookFromRawSheet('MoM Summary', 'MoM Summary', momSheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('MoM Summary');
    worksheet.mergeCells('A1:J1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    worksheet.addRow([
      'Month',
      'Opening Balance',
      'Closing Balance',
      'Total Credits',
      'Total Debits',
      'Net Flow',
      'Cash Deposits',
      'Cash Withdrawals',
      'UPI Credit',
      'UPI Debit',
    ]);
    worksheet.getRow(3).font = { bold: true };

    (report.momSummary || report.metrics || []).forEach((row: any) => {
      worksheet.addRow([
        row.month,
        (row.openingBal ?? row.opening ?? 0).toFixed?.(2) ?? Number(row.openingBal || row.opening || 0).toFixed(2),
        (row.closingBal ?? row.closing ?? 0).toFixed?.(2) ?? Number(row.closingBal || row.closing || 0).toFixed(2),
        (row.totalCredits ?? 0).toFixed?.(2) ?? Number(row.totalCredits || 0).toFixed(2),
        (row.totalDebits ?? 0).toFixed?.(2) ?? Number(row.totalDebits || 0).toFixed(2),
        (row.netFlow ?? 0).toFixed?.(2) ?? Number(row.netFlow || 0).toFixed(2),
        (row.cashDeposits ?? 0).toFixed?.(2) ?? Number(row.cashDeposits || 0).toFixed(2),
        (row.cashWithdrawals ?? 0).toFixed?.(2) ?? Number(row.cashWithdrawals || 0).toFixed(2),
        (row.upiCredit ?? 0).toFixed?.(2) ?? Number(row.upiCredit || 0).toFixed(2),
        (row.upiDebit ?? 0).toFixed?.(2) ?? Number(row.upiDebit || 0).toFixed(2),
      ]);
    });

    worksheet.columns.forEach((column) => {
      column.width = 18;
    });

    return workbook;
  }

  /**
   * Loans & EMI module
   */
  async generateLoansAndEmi(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    const loansSheet = report.loansSheet;

    if (loansSheet && loansSheet.length > 0) {
      return this.createWorkbookFromRawSheet('Loans and EMI', 'Loans & EMI', loansSheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Loans and EMI');
    worksheet.mergeCells('A1:H1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    worksheet.addRow([
      'Lender',
      'Facility Type',
      'Sanctioned',
      'Outstanding',
      'EMI',
      'Rate',
      'Tenor',
      'Status',
    ]);
    worksheet.getRow(3).font = { bold: true };

    (report.loans || []).forEach((loan) => {
      worksheet.addRow([
        loan.lender,
        loan.type,
        loan.sanctioned.toFixed(2),
        loan.outstanding.toFixed(2),
        loan.emi.toFixed(2),
        loan.rate,
        loan.tenor,
        loan.status,
      ]);
    });

    worksheet.columns.forEach((column) => {
      column.width = 18;
    });

    return workbook;
  }

  /**
   * EMI Tracker module
   */
  async generateEmiTracker(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    if (report.emiTrackerSheet && report.emiTrackerSheet.length > 0) {
      return this.createWorkbookFromRawSheet('EMI Tracker', 'EMI Tracker', report.emiTrackerSheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('EMI Tracker');

    worksheet.addRow(['RMH Advisors Pvt Ltd - EMI Tracker']);
    worksheet.mergeCells('A1:F1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    worksheet.addRow(['Month', 'Lender', 'Type', 'EMI Due', 'Paid On', 'Status']);
    worksheet.getRow(3).font = { bold: true };

    (report.emiTracker || []).forEach((row) => {
      worksheet.addRow([
        row.month,
        row.lender,
        row.type,
        row.emiDue.toFixed(2),
        row.paidOn,
        row.status,
      ]);
    });

    worksheet.columns.forEach((column) => {
      column.width = 18;
    });

    return workbook;
  }

  /**
   * Trade Credits module
   */
  async generateTradeCredits(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    if (report.tradeCreditsSheet && report.tradeCreditsSheet.length > 0) {
      return this.createWorkbookFromRawSheet('Trade Credits', 'Trade Credits', report.tradeCreditsSheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Trade Credits');

    worksheet.addRow(['RMH Advisors Pvt Ltd - Trade Credits']);
    worksheet.mergeCells('A1:E1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    worksheet.addRow(['Date', 'Customer', 'Amount', 'Mode', 'Narration']);
    worksheet.getRow(3).font = { bold: true };

    (report.tradeCredits || []).forEach((row) => {
      worksheet.addRow([
        row.date,
        row.party,
        row.amount.toFixed(2),
        row.mode,
        row.narration,
      ]);
    });

    worksheet.columns.forEach((column) => {
      column.width = 20;
    });

    return workbook;
  }

  /**
   * Trade Debits module
   */
  async generateTradeDebits(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    if (report.tradeDebitsSheet && report.tradeDebitsSheet.length > 0) {
      return this.createWorkbookFromRawSheet('Trade Debits', 'Trade Debits', report.tradeDebitsSheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Trade Debits');

    worksheet.addRow(['RMH Advisors Pvt Ltd - Trade Debits']);
    worksheet.mergeCells('A1:E1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    worksheet.addRow(['Date', 'Vendor', 'Amount', 'Mode', 'Narration']);
    worksheet.getRow(3).font = { bold: true };

    (report.tradeDebits || []).forEach((row) => {
      worksheet.addRow([
        row.date,
        row.party,
        row.amount.toFixed(2),
        row.mode,
        row.narration,
      ]);
    });

    worksheet.columns.forEach((column) => {
      column.width = 20;
    });

    return workbook;
  }

  /**
   * Highest Transactions module
   */
  async generateHighestTransactions(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    if (report.highestTnsSheet && report.highestTnsSheet.length > 0) {
      return this.createWorkbookFromRawSheet('Highest Tns', 'Highest Transactions', report.highestTnsSheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Highest Tns');

    worksheet.addRow(['RMH Advisors Pvt Ltd - Highest Transactions']);
    worksheet.mergeCells('A1:F1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    worksheet.addRow(['Rank', 'Date', 'Type', 'Counterparty', 'Amount', 'Narration']);
    worksheet.getRow(3).font = { bold: true };

    (report.highestTns || []).forEach((row) => {
      worksheet.addRow([
        row.rank,
        row.date,
        row.type,
        row.party,
        row.amount.toFixed(2),
        row.narration,
      ]);
    });

    worksheet.columns.forEach((column) => {
      column.width = 20;
    });

    return workbook;
  }

  /**
   * Internal & Group module
   */
  async generateInternalGroup(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    if (report.internalGroupSheet && report.internalGroupSheet.length > 0) {
      return this.createWorkbookFromRawSheet('Internal & Group', 'Internal & Group', report.internalGroupSheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Internal & Group');

    worksheet.addRow(['RMH Advisors Pvt Ltd - Internal & Group Transactions']);
    worksheet.mergeCells('A1:E1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    worksheet.addRow(['Date', 'Counterparty', 'Direction', 'Amount', 'Narration']);
    worksheet.getRow(3).font = { bold: true };

    (report.internalGroup || []).forEach((row) => {
      worksheet.addRow([
        row.date,
        row.party,
        row.direction,
        row.amount.toFixed(2),
        row.narration,
      ]);
    });

    worksheet.columns.forEach((column) => {
      column.width = 20;
    });

    return workbook;
  }

  /**
   * Circular Flows module
   */
  async generateCircularFlows(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    if (report.circularSheet && report.circularSheet.length > 0) {
      return this.createWorkbookFromRawSheet('Circular', 'Circular Flows', report.circularSheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Circular');

    worksheet.addRow(['RMH Advisors Pvt Ltd - Circular Transactions']);
    worksheet.mergeCells('A1:F1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    worksheet.addRow(['ID', 'Chain', 'Amount', 'Window', 'Date', 'Risk']);
    worksheet.getRow(3).font = { bold: true };

    (report.circular || []).forEach((row) => {
      worksheet.addRow([
        row.id,
        row.chain,
        row.amount.toFixed(2),
        row.window,
        row.date,
        row.risk,
      ]);
    });

    worksheet.columns.forEach((column) => {
      column.width = 24;
    });

    return workbook;
  }

  /**
   * Net Transactions module
   */
  async generateNetTransactions(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    if (report.netTransactionsSheet && report.netTransactionsSheet.length > 0) {
      return this.createWorkbookFromRawSheet('Net Transactions', 'Net Transactions', report.netTransactionsSheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Net Transactions');

    worksheet.addRow(['RMH Advisors Pvt Ltd - Net Transactions']);
    worksheet.mergeCells('A1:D1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    worksheet.addRow(['Month', 'Credits', 'Debits', 'Net']);
    worksheet.getRow(3).font = { bold: true };

    (report.netTransactions || []).forEach((row) => {
      worksheet.addRow([
        row.month,
        row.credits.toFixed(2),
        row.debits.toFixed(2),
        row.net.toFixed(2),
      ]);
    });

    worksheet.columns.forEach((column) => {
      column.width = 18;
    });

    return workbook;
  }

  /**
   * Staff Emoluments module
   */
  async generateStaffEmoluments(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    if (report.staffEmolumentsSheet && report.staffEmolumentsSheet.length > 0) {
      return this.createWorkbookFromRawSheet('Staff Emoluments', 'Staff Emoluments', report.staffEmolumentsSheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Staff Emoluments');

    worksheet.addRow(['RMH Advisors Pvt Ltd - Staff Emoluments']);
    worksheet.mergeCells('A1:D1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    worksheet.addRow(['Month', 'Employees', 'Total Payout', 'Avg / Employee']);
    worksheet.getRow(3).font = { bold: true };

    (report.staffEmoluments || []).forEach((row) => {
      worksheet.addRow([
        row.month,
        row.count,
        row.total.toFixed(2),
        row.avg.toFixed(2),
      ]);
    });

    worksheet.columns.forEach((column) => {
      column.width = 18;
    });

    return workbook;
  }

  /**
   * Spend Analysis module
   */
  async generateSpendAnalysis(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    if (report.spendAnalysisSheet && report.spendAnalysisSheet.length > 0) {
      return this.createWorkbookFromRawSheet('Spend Analysis', 'Spend Analysis', report.spendAnalysisSheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Spend Analysis');

    worksheet.addRow(['RMH Advisors Pvt Ltd - Spend Analysis']);
    worksheet.mergeCells('A1:D1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    worksheet.addRow(['Category', 'Amount', 'Share %']);
    worksheet.getRow(3).font = { bold: true };

    (report.spendAnalysis || []).forEach((row) => {
      worksheet.addRow([
        row.category,
        row.amount.toFixed(2),
        row.pct,
      ]);
    });

    worksheet.columns.forEach((column) => {
      column.width = 22;
    });

    return workbook;
  }

  /**
   * Bill Payments module
   */
  async generateBillPayments(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    if (report.billPaymentsSheet && report.billPaymentsSheet.length > 0) {
      return this.createWorkbookFromRawSheet('Bill Payments', 'Bill Payments', report.billPaymentsSheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Bill Payments');

    worksheet.addRow(['RMH Advisors Pvt Ltd - Bill Payments']);
    worksheet.mergeCells('A1:E1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    worksheet.addRow(['Biller', 'Category', 'Avg Monthly', 'Last Paid', 'Consistent']);
    worksheet.getRow(3).font = { bold: true };

    (report.billPayments || []).forEach((row) => {
      worksheet.addRow([
        row.biller,
        row.category,
        row.monthly.toFixed(2),
        row.lastPaid,
        row.consistent ? 'Yes' : 'No',
      ]);
    });

    worksheet.columns.forEach((column) => {
      column.width = 20;
    });

    return workbook;
  }

  /**
   * Recurring Debits module
   */
  async generateRecurringDebits(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    if (report.recurringDebitSheet && report.recurringDebitSheet.length > 0) {
      return this.createWorkbookFromRawSheet('Recurring Debit', 'Recurring Debits', report.recurringDebitSheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Recurring Debit');

    worksheet.addRow(['RMH Advisors Pvt Ltd - Recurring Debits']);
    worksheet.mergeCells('A1:E1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    worksheet.addRow(['Merchant / Payee', 'Frequency', 'Amount', 'Occurrences', 'Last Seen']);
    worksheet.getRow(3).font = { bold: true };

    (report.recurringDebit || []).forEach((row) => {
      worksheet.addRow([
        row.merchant,
        row.frequency,
        row.amount.toFixed(2),
        row.occurrences,
        row.lastDate,
      ]);
    });

    worksheet.columns.forEach((column) => {
      column.width = 22;
    });

    return workbook;
  }

  /**
   * Recurring Credits module
   */
  async generateRecurringCredits(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    if (report.recurringCreditSheet && report.recurringCreditSheet.length > 0) {
      return this.createWorkbookFromRawSheet('Recurring Credit', 'Recurring Credits', report.recurringCreditSheet, report);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Recurring Credit');

    worksheet.addRow(['RMH Advisors Pvt Ltd - Recurring Credits']);
    worksheet.mergeCells('A1:E1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    worksheet.addRow(['Source', 'Frequency', 'Avg Amount', 'Occurrences', 'Last Seen']);
    worksheet.getRow(3).font = { bold: true };

    (report.recurringCredit || []).forEach((row) => {
      worksheet.addRow([
        row.source,
        row.frequency,
        row.avgAmount.toFixed(2),
        row.occurrences,
        row.lastDate,
      ]);
    });

    worksheet.columns.forEach((column) => {
      column.width = 22;
    });

    return workbook;
  }

  private styleSummaryHeader(row: ExcelJS.Row): void {
    row.eachCell((cell) => {
      cell.font = { name: "Calibri", bold: true, size: 10, color: { argb: EXCEL_THEME.primary } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: EXCEL_THEME.headerBg },
      };
      cell.border = {
        top: { style: "thin", color: { argb: EXCEL_THEME.borderStrong } },
        bottom: { style: "thin", color: { argb: EXCEL_THEME.borderStrong } },
        left: { style: "thin", color: { argb: EXCEL_THEME.border } },
        right: { style: "thin", color: { argb: EXCEL_THEME.border } },
      };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    });
  }

  private styleSectionBanner(
    worksheet: ExcelJS.Worksheet,
    row: ExcelJS.Row,
    label: string,
    colSpan = 9,
  ): void {
    row.getCell(1).value = label;
    row.getCell(1).font = { name: "Calibri", bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    row.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: EXCEL_THEME.primary },
    };
    row.getCell(1).alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    if (colSpan > 1) {
      worksheet.mergeCells(row.number, 1, row.number, colSpan);
    }
    row.height = 22;
  }

  private mapLedgerVchType(direction: string, mode: string, category: string): string {
    const dir = String(direction || "").toUpperCase();
    const payMode = String(mode || "").toUpperCase();
    const cat = String(category || "").toUpperCase();
    if (dir === "CREDIT" && (payMode === "CASH" || cat === "CASH")) return "Contra";
    if (dir === "CREDIT") return "Receipt";
    return "Payment";
  }

  private mapComparisonLedger(mode: string, category: string, narration: string): string {
    const text = `${mode} ${category} ${narration}`.toUpperCase();
    if (/\bCASH\b/.test(text)) return "Cash";
    if (/\b(EMI|LOAN|NACH|ECS|ACH|AUTOPAY|MANDATE)\b/.test(text)) return "EMI / Loan";
    if (/\b(CHARGE|CHARGES|GST|FEE|PENAL|BOUNCE)\b/.test(text)) return "Bank Charges";
    if (/\b(INTEREST|INT\.?)\b/.test(text)) return "Interest";
    if (/\b(SALARY|WAGES|STAFF)\b/.test(text)) return "Salary / Staff";
    if (/\b(SWEEP|FD|FIXED DEPOSIT|AUTOSWEEP)\b/.test(text)) return "Others";
    return "Others";
  }

  private parseTxnSortDate(dateText?: string): number {
    if (!dateText) return 0;
    const ts = Date.parse(dateText);
    return Number.isFinite(ts) ? ts : 0;
  }

  private safeWorksheetName(base: string, usedNames: Set<string>): string {
    const cleaned = String(base || "Party")
      .replace(/[\\/*?:[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 28) || "Party";
    let name = cleaned;
    let counter = 2;
    while (usedNames.has(name.toUpperCase())) {
      const suffix = ` ${counter}`;
      name = `${cleaned.slice(0, 31 - suffix.length)}${suffix}`;
      counter += 1;
    }
    usedNames.add(name.toUpperCase());
    return name;
  }

  private addTransactionRowsSheet(
    workbook: ExcelJS.Workbook,
    sheetName: string,
    title: string,
    rows: Array<{
      party: string;
      rawParty: string;
      dateText: string;
      direction: string;
      mode: string;
      category: string;
      debit: number;
      credit: number;
      narration: string;
    }>,
    options?: { backToSummary?: boolean },
  ): ExcelJS.Worksheet {
    const worksheet = workbook.addWorksheet(sheetName);
    worksheet.addRow([title]);
    worksheet.mergeCells("A1:I1");
    worksheet.getCell("A1").font = { name: "Calibri", bold: true, size: 13, color: { argb: EXCEL_THEME.primary } };

    if (options?.backToSummary) {
      worksheet.addRow([
        {
          text: "◄ Back to Party Summary",
          hyperlink: "#'Party Summary'!A1",
          tooltip: "Return to party totals",
        },
      ]);
      worksheet.getCell("A2").font = {
        name: "Calibri",
        bold: true,
        size: 11,
        color: { argb: "FF0563C1" },
        underline: true,
      };
    } else {
      worksheet.addRow([]);
    }

    // "Grouped Party" is the canonical/normalized label this row was merged under (same value
    // for every row in a party's block). "Original Party" is what was extracted from *this*
    // transaction's own narration before cross-transaction merging -- it can legitimately
    // differ row to row within one group (e.g. "VIJAY" and "VIJAY JAS UTIB" both under the
    // "VIJAY JAS" group). Keeping both lets a CA reconcile any row back to the exact source
    // line even after the sheet is filtered/sorted and its visual grouping is gone.
    const headerRow = worksheet.addRow([
      "Grouped Party",
      "Original Party",
      "Date",
      "Dr/Cr",
      "Mode",
      "Category",
      "Debit",
      "Credit",
      "Narration",
    ]);
    this.styleSummaryHeader(headerRow);

    rows.forEach((row) => {
      const excelRow = worksheet.addRow([
        row.party,
        row.rawParty,
        row.dateText,
        row.direction,
        row.mode,
        row.category,
        row.debit > 0 ? row.debit : "",
        row.credit > 0 ? row.credit : "",
        row.narration,
      ]);
      excelRow.getCell(9).alignment = { wrapText: true, vertical: "top" };
    });

    if (rows.length > 0) {
      worksheet.autoFilter = {
        from: { row: headerRow.number, column: 1 },
        to: { row: headerRow.number + rows.length, column: 9 },
      };
    }

    applyConsistentSheetFormatting(worksheet);
    [7, 8].forEach((col) => worksheet.getColumn(col).numFmt = INR_NUM_FMT);
    worksheet.views = [{ state: "frozen", ySplit: headerRow.number, activeCell: "A" + (headerRow.number + 1) }];
    worksheet.getColumn(1).width = 30;
    worksheet.getColumn(2).width = 26;
    worksheet.getColumn(3).width = 12;
    worksheet.getColumn(4).width = 8;
    worksheet.getColumn(5).width = 14;
    worksheet.getColumn(6).width = 16;
    worksheet.getColumn(7).width = 14;
    worksheet.getColumn(8).width = 14;
    worksheet.getColumn(9).width = 64;
    return worksheet;
  }

  /**
   * Compact party summary: single sheet, native Excel outline drill-down only.
   */
  async generateTransactionsSummary(
    report: AnalysisReport,
  ): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Party Summary");
    worksheet.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
    const allTxns = report.transactions || [];
    const client = report.applicant?.name || report.accountInfo?.accountName || "Client";
    const bank0 = report.applicant?.banks?.[0];
    const period = report.applicant?.period || "";
    const subtitle = bank0
      ? `Account: ${bank0.account} · ${bank0.name}${
          bank0.ifsc && bank0.ifsc !== "-" ? ` · ${bank0.ifsc}` : ""
        }${period ? ` · ${period}` : ""}`
      : report.accountInfo?.bank || "Bank";

    worksheet.addRow([client]);
    worksheet.addRow([subtitle]);
    worksheet.addRow(["Use Excel outline (+/-) controls to expand party transactions in this same sheet."]);
    worksheet.mergeCells("A1:H1");
    worksheet.mergeCells("A2:H2");
    worksheet.mergeCells("A3:H3");
    [1, 2, 3].forEach((rowNumber) => {
      const row = worksheet.getRow(rowNumber);
      row.height = rowNumber === 1 ? 24 : 20;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: rowNumber === 1 ? "FFE9EDF5" : "FFF7F9FC" },
        };
        cell.border = {
          top: { style: "thin", color: { argb: EXCEL_THEME.border } },
          bottom: { style: "thin", color: { argb: EXCEL_THEME.border } },
          left: { style: "thin", color: { argb: EXCEL_THEME.border } },
          right: { style: "thin", color: { argb: EXCEL_THEME.border } },
        };
        cell.alignment = { vertical: "middle", horizontal: rowNumber === 1 ? "center" : "left", wrapText: true };
      });
    });
    worksheet.getCell("A1").font = { name: "Calibri", bold: true, size: 14, color: { argb: EXCEL_THEME.primary } };
    worksheet.getCell("A2").font = { name: "Calibri", bold: true, size: 10, color: { argb: EXCEL_THEME.text } };
    worksheet.getCell("A3").font = { name: "Calibri", italic: true, size: 10, color: { argb: EXCEL_THEME.link } };
    worksheet.addRow([]);

    const { summary: summaryRows, byParty: partyGroups } = buildPartyLedger(allTxns);
    const headerRow = worksheet.addRow([
      "Party Name",
      "No of Transactions",
      "Debit Amount",
      "Credit Amount",
      "Net Transaction",
      "Modes",
    ]);
    this.styleSummaryHeader(headerRow);

    summaryRows.forEach((summary, index) => {
      const detailTxns = partyGroups.get(summary.party) || [];
      const partyRows = detailTxns.map((txn) => {
        const extraction = extractPartyLedgerFields(txn);
        return {
          party: summary.party,
          rawParty: extraction.normalized_party_name,
          dateText: txn.dateText || "",
          direction: txn.direction || extraction.debit_credit,
          mode: extraction.transaction_mode,
          category: extraction.category,
          debit: Number(txn.debit || 0),
          credit: Number(txn.credit || 0),
          narration: txn.narration || "",
        };
      }).sort((a, b) => this.parseTxnSortDate(a.dateText) - this.parseTxnSortDate(b.dateText));
      const summaryExcelRow = worksheet.addRow([
        summary.party,
        summary.txnCount,
        summary.debit,
        summary.credit,
        summary.net,
        summary.transactionModes.join(", "),
      ]);
      summaryExcelRow.font = { name: "Calibri", bold: true, size: 10, color: { argb: EXCEL_THEME.text } };
      summaryExcelRow.height = 22;
      summaryExcelRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: index % 2 === 0 ? "FFFFFFFF" : "FFF7F9FC" },
        };
        cell.border = {
          top: { style: "thin", color: { argb: EXCEL_THEME.border } },
          bottom: { style: "thin", color: { argb: EXCEL_THEME.border } },
          left: { style: "thin", color: { argb: EXCEL_THEME.border } },
          right: { style: "thin", color: { argb: EXCEL_THEME.border } },
        };
        cell.alignment = { vertical: "middle", wrapText: true };
      });
      summaryExcelRow.getCell(2).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE6F0FF" },
      };
      summaryExcelRow.getCell(2).font = { name: "Calibri", bold: true, color: { argb: EXCEL_THEME.primary } };
      summaryExcelRow.getCell(2).alignment = { horizontal: "center", vertical: "middle" };

      const detailHeader = worksheet.addRow([
        "Grouped Party",
        "Original Party",
        "Date",
        "Mode",
        "Dr/Cr",
        "Debit",
        "Credit",
        "Narration",
      ]);
      detailHeader.outlineLevel = 1;
      detailHeader.hidden = true;
      detailHeader.font = { name: "Calibri", bold: true, size: 9, color: { argb: EXCEL_THEME.primary } };
      detailHeader.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFEDEFF3" },
        };
        cell.border = {
          top: { style: "thin", color: { argb: EXCEL_THEME.border } },
          bottom: { style: "thin", color: { argb: EXCEL_THEME.border } },
          left: { style: "thin", color: { argb: EXCEL_THEME.border } },
          right: { style: "thin", color: { argb: EXCEL_THEME.border } },
        };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      });

      partyRows.forEach((row) => {
        const detailRow = worksheet.addRow([
          row.party,
          row.rawParty,
          row.dateText,
          row.mode,
          row.direction,
          row.debit > 0 ? row.debit : "",
          row.credit > 0 ? row.credit : "",
          row.narration,
        ]);
        detailRow.outlineLevel = 1;
        detailRow.hidden = true;
        detailRow.height = 28;
        detailRow.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF1F2F4" },
          };
          cell.border = {
            top: { style: "thin", color: { argb: "FFD8DEE8" } },
            bottom: { style: "thin", color: { argb: "FFD8DEE8" } },
            left: { style: "thin", color: { argb: "FFD8DEE8" } },
            right: { style: "thin", color: { argb: "FFD8DEE8" } },
          };
          cell.alignment = { vertical: "top", wrapText: true };
        });
        detailRow.getCell(1).alignment = { vertical: "top", horizontal: "left", indent: 1 };
        detailRow.getCell(8).alignment = { vertical: "top", wrapText: true };
      });
    });

    if (summaryRows.length > 0) {
      worksheet.autoFilter = {
        from: { row: headerRow.number, column: 1 },
        to: { row: worksheet.rowCount, column: 8 },
      };
    }

    // Columns 3-5 carry the summary row's Debit/Credit/Net; columns 6-7 carry the detail row's
    // Debit/Credit (the two row kinds share column indices but not column meaning -- see the
    // header rows above). Applying INR formatting to all five is harmless for the columns
    // where a given row type instead holds text (format only affects numeric cell values).
    [3, 4, 5, 6, 7].forEach((col) => worksheet.getColumn(col).numFmt = INR_NUM_FMT);
    worksheet.views = [{ state: "frozen", xSplit: 1, ySplit: headerRow.number, activeCell: "B" + (headerRow.number + 1) }];
    worksheet.getColumn(1).width = 36;
    worksheet.getColumn(2).width = 24;
    worksheet.getColumn(3).width = 14;
    worksheet.getColumn(4).width = 14;
    worksheet.getColumn(5).width = 14;
    worksheet.getColumn(6).width = 14;
    worksheet.getColumn(7).width = 14;
    worksheet.getColumn(8).width = 70;
    worksheet.columns.forEach((column) => {
      let maxLength = column.width || 10;
      column.eachCell?.({ includeEmpty: false }, (cell) => {
        const value = typeof cell.value === "object" && cell.value && "text" in cell.value
          ? String(cell.value.text || "")
          : String(cell.value ?? "");
        maxLength = Math.max(maxLength, Math.min(value.length + 2, column.number === 8 ? 80 : 40));
      });
      column.width = maxLength;
    });

    return workbook;
  }

  /**
   * CA party summary: hyperlink navigation to dedicated party worksheets.
   */
  async generateTransactionsSummaryCA(
    report: AnalysisReport,
  ): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Party Summary");
    const allTxns = report.transactions || [];
    const client = report.applicant?.name || report.accountInfo?.accountName || "Client";
    const bank0 = report.applicant?.banks?.[0];
    const period = report.applicant?.period || "";
    const subtitle = bank0
      ? `Account: ${bank0.account} · ${bank0.name}${
          bank0.ifsc && bank0.ifsc !== "-" ? ` · ${bank0.ifsc}` : ""
        }${period ? ` · ${period}` : ""}`
      : report.accountInfo?.bank || "Bank";

    worksheet.addRow([client]);
    worksheet.addRow([subtitle]);
    worksheet.addRow(["Click View Rows to open the dedicated party worksheet."]);
    worksheet.mergeCells("A1:G1");
    worksheet.mergeCells("A2:G2");
    worksheet.mergeCells("A3:G3");
    worksheet.getCell("A1").font = { name: "Calibri", bold: true, size: 14, color: { argb: EXCEL_THEME.primary } };
    worksheet.getCell("A2").font = { name: "Calibri", bold: true, size: 10, color: { argb: EXCEL_THEME.text } };
    worksheet.getCell("A3").font = { name: "Calibri", italic: true, size: 10, color: { argb: EXCEL_THEME.link } };
    worksheet.addRow([]);

    const { summary: summaryRows, byParty: partyGroups } = buildPartyLedger(allTxns);
    const usedSheetNames = new Set(workbook.worksheets.map((sheet) => sheet.name.toUpperCase()));
    const flatRows: Array<{
      party: string;
      rawParty: string;
      dateText: string;
      direction: string;
      mode: string;
      category: string;
      debit: number;
      credit: number;
      narration: string;
    }> = [];
    const partySheetByName = new Map<string, string>();

    const headerRow = worksheet.addRow([
      "Party Name",
      "No of Transactions",
      "Debit Amount",
      "Credit Amount",
      "Net Transaction",
      "Modes",
      "View Rows",
    ]);
    this.styleSummaryHeader(headerRow);

    summaryRows.forEach((summary) => {
      const detailTxns = partyGroups.get(summary.party) || [];
      const partyRows = detailTxns.map((txn) => {
        const extraction = extractPartyLedgerFields(txn);
        return {
          party: summary.party,
          rawParty: extraction.normalized_party_name,
          dateText: txn.dateText || "",
          direction: txn.direction || extraction.debit_credit,
          mode: extraction.transaction_mode,
          category: extraction.category,
          debit: Number(txn.debit || 0),
          credit: Number(txn.credit || 0),
          narration: txn.narration || "",
        };
      }).sort((a, b) => this.parseTxnSortDate(a.dateText) - this.parseTxnSortDate(b.dateText));

      flatRows.push(...partyRows);
      const partySheetName = this.safeWorksheetName(summary.party, usedSheetNames);
      partySheetByName.set(summary.party, partySheetName);
      this.addTransactionRowsSheet(workbook, partySheetName, `${summary.party} (${summary.txnCount} transactions)`, partyRows, {
        backToSummary: true,
      });
    });

    summaryRows.forEach((row, index) => {
      const partySheetName = partySheetByName.get(row.party);
      const excelRow = worksheet.addRow([
        row.party,
        row.txnCount,
        row.debit,
        row.credit,
        row.net,
        row.transactionModes.join(", "),
        partySheetName
          ? {
              text: "View Rows",
              hyperlink: `#'${partySheetName}'!A1`,
              tooltip: `Open ${row.party} transactions`,
            }
          : "",
      ]);
      excelRow.font = { name: "Calibri", bold: true, size: 10, color: { argb: EXCEL_THEME.text } };
      excelRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: index % 2 === 0 ? "FFFFFFFF" : "FFF7F9FC" },
        };
        cell.border = {
          top: { style: "thin", color: { argb: EXCEL_THEME.border } },
          bottom: { style: "thin", color: { argb: EXCEL_THEME.border } },
          left: { style: "thin", color: { argb: EXCEL_THEME.border } },
          right: { style: "thin", color: { argb: EXCEL_THEME.border } },
        };
        cell.alignment = { vertical: "middle", wrapText: true };
      });
      excelRow.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
      excelRow.getCell(2).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE6F0FF" },
      };
      excelRow.getCell(7).font = { name: "Calibri", bold: true, color: { argb: "FF0563C1" }, underline: true };
      excelRow.getCell(7).alignment = { horizontal: "center", vertical: "middle" };
    });

    flatRows.sort((a, b) => {
      const partyCmp = a.party.localeCompare(b.party);
      if (partyCmp !== 0) return partyCmp;
      return this.parseTxnSortDate(a.dateText) - this.parseTxnSortDate(b.dateText);
    });
    if (flatRows.length > 0) {
      this.addTransactionRowsSheet(workbook, "All Transactions", "All Transactions", flatRows, {
        backToSummary: true,
      });
    }

    if (summaryRows.length > 0) {
      worksheet.autoFilter = {
        from: { row: headerRow.number, column: 1 },
        to: { row: headerRow.number + summaryRows.length, column: 7 },
      };
    }

    [3, 4, 5].forEach((col) => worksheet.getColumn(col).numFmt = INR_NUM_FMT);
    worksheet.views = [{ state: "frozen", ySplit: headerRow.number, activeCell: "A" + (headerRow.number + 1) }];
    worksheet.getColumn(1).width = 36;
    worksheet.getColumn(2).width = 18;
    worksheet.getColumn(3).width = 16;
    worksheet.getColumn(4).width = 16;
    worksheet.getColumn(5).width = 16;
    worksheet.getColumn(6).width = 24;
    worksheet.getColumn(7).width = 14;

    return workbook;
  }

  /**
   * Manual comparison export. One row per bank transaction, shaped like the office ledger.
   */
  async generateTransactionsLedgerBook(
    report: AnalysisReport,
  ): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    const allTxns = report.transactions || [];
    const client = report.applicant?.name || report.accountInfo?.accountName || "Client";
    const bank0 = report.applicant?.banks?.[0];
    const bankLabel = bank0?.name || report.accountInfo?.bank || "Bank";
    const accountSuffix = bank0?.account?.slice(-5) || report.accountInfo?.accountNumber?.slice(-5) || "";
    const period = report.applicant?.period || "Statement Period";
    const sheetName = "Ledger Book Compare";
    const worksheet = workbook.addWorksheet(sheetName.slice(0, 31));

    worksheet.addRow([client]);
    worksheet.addRow([`${bankLabel} ${accountSuffix} Book`]);
    worksheet.addRow([period]);
    worksheet.addRow([]);
    worksheet.mergeCells("A1:H1");
    worksheet.mergeCells("A2:H2");
    worksheet.mergeCells("A3:H3");

    const headerRow = worksheet.addRow([
      "Date",
      "Party Name",
      "Original Party",
      "Counter Party / Ledger",
      "Voucher Number",
      "Narration",
      "Debit",
      "Credit",
    ]);
    this.styleSummaryHeader(headerRow);

    const chronology = [...allTxns].sort(
      (a, b) => this.parseTxnSortDate(a.dateText) - this.parseTxnSortDate(b.dateText),
    );
    const partyGroups = groupTransactionsByParty(allTxns);
    const txnParty = new Map<object, string>();
    partyGroups.forEach((txns, party) => {
      txns.forEach((txn) => {
        txnParty.set(txn, party);
      });
    });

    let vchCounter = 0;
    chronology.forEach((txn) => {
      const extraction = extractPartyLedgerFields(txn);
      const party =
        txnParty.get(txn) ||
        extraction.normalized_party_name ||
        txn.party ||
        "UNRECOGNIZED";
      const debit = Number(txn.debit || 0);
      const credit = Number(txn.credit || 0);
      const isOutflow = debit > 0;
      vchCounter += 1;

      // In bank-book comparison, credits/inflows increase the bank ledger, so they sit in Debit.
      const ledgerDebit = isOutflow ? "" : credit > 0 ? credit : debit;
      const ledgerCredit = isOutflow ? debit : "";

      const ledgerRow = worksheet.addRow([
        txn.dateText ? new Date(txn.dateText) : "",
        party,
        extraction.normalized_party_name,
        this.mapComparisonLedger(extraction.transaction_mode, extraction.category, txn.narration || ""),
        vchCounter,
        txn.narration || "",
        ledgerDebit,
        ledgerCredit,
      ]);
      ledgerRow.getCell(1).numFmt = "dd-mmm-yyyy";
      ledgerRow.getCell(6).alignment = { wrapText: true, vertical: "top" };
      if (ledgerDebit) ledgerRow.getCell(7).numFmt = INR_NUM_FMT;
      if (ledgerCredit) ledgerRow.getCell(8).numFmt = INR_NUM_FMT;
    });

    if (chronology.length > 0) {
      worksheet.autoFilter = {
        from: { row: headerRow.number, column: 1 },
        to: { row: headerRow.number + chronology.length, column: 8 },
      };
    }

    applyConsistentSheetFormatting(worksheet);
    worksheet.views = [{ state: "frozen", ySplit: headerRow.number, activeCell: "A" + (headerRow.number + 1) }];
    worksheet.getColumn(1).width = 12;
    worksheet.getColumn(2).width = 34;
    worksheet.getColumn(3).width = 26;
    worksheet.getColumn(4).width = 22;
    worksheet.getColumn(5).width = 14;
    worksheet.getColumn(6).width = 64;
    worksheet.getColumn(7).width = 16;
    worksheet.getColumn(8).width = 16;

    return workbook;
  }

  /**
   * Generate Excel file for any module based on module name
   */
  async generateModuleExcel(
    moduleName: string,
    report: AnalysisReport,
    options?: { party?: string },
  ): Promise<ExcelJS.Workbook> {
    switch (moduleName.toLowerCase()) {
      case 'raw-data':
        if (report.rawDataSheet && report.rawDataSheet.length > 0) {
          return this.createWorkbookFromRawSheet('Raw Data', 'Raw Data', report.rawDataSheet, report);
        }
        return this.createWorkbookFromRawSheet(
          'Raw Data',
          'Raw Data',
          this.buildFallbackRawData(report),
          report,
        );
      case 'executive-summary':
        return this.generateExecutiveSummary(report);
      case 'flags':
      case 'flags-risk':
      case 'flags-and-risk':
        return this.generateFlagsAndRisk(report);
      case 'cam-analysis':
        return this.generateCamAnalysis(report);
      case 'mom-summary':
        return this.generateMomSummary(report);
      case 'monthly-cf':
      case 'monthly-cash-flow':
      case 'cashflow':
        return this.generateMonthlyCashFlow(report);
      case 'bounce-penal':
      case 'bounce-penal-charges':
        return this.generateBounceAndPenal(report);
      case 'salary':
        return this.generateSalary(report);
      case 'loans-emi':
        return this.generateLoansAndEmi(report);
      case 'emi-tracker':
        return this.generateEmiTracker(report);
      case 'trade-credits':
        return this.generateTradeCredits(report);
      case 'trade-debits':
        return this.generateTradeDebits(report);
      case 'highest-transactions':
        return this.generateHighestTransactions(report);
      case 'internal-group':
        return this.generateInternalGroup(report);
      case 'circular-flows':
        return this.generateCircularFlows(report);
      case 'net-transactions':
        return this.generateNetTransactions(report);
      case 'staff-emoluments':
        return this.generateStaffEmoluments(report);
      case 'spend-analysis':
        return this.generateSpendAnalysis(report);
      case 'bill-payments':
        return this.generateBillPayments(report);
      case 'recurring-debits':
        return this.generateRecurringDebits(report);
      case 'recurring-credits':
        return this.generateRecurringCredits(report);
      case 'transactions-summary':
        return this.generateTransactionsSummary(report);
      case 'transactions-summary-ca':
      case 'party-analysis-ca':
        return this.generateTransactionsSummaryCA(report);
      case 'transactions-ledger':
      case 'ledger-book':
      case 'manual-ledger':
        return this.generateTransactionsLedgerBook(report);
      default:
        return this.generateGenericModule(moduleName, report);
    }
  }

  /**
   * Generate master Excel workbook with all 20 module sheets
   */
  async generateMasterReport(report: AnalysisReport): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "RMH Party Ledger Analyzer";
    workbook.created = new Date();

    this.addDisclaimerSheet(workbook, report);
    this.addIndexSheet(workbook);

    for (const module of this.masterModules) {
      await this.appendModuleSheet(workbook, module.key, module.title, report);
    }

    return workbook;
  }

  private async appendModuleSheet(
    workbook: ExcelJS.Workbook,
    moduleKey: string,
    title: string,
    report: AnalysisReport,
  ): Promise<void> {
    const moduleWorkbook = await this.generateModuleExcel(moduleKey, report);
    const sourceSheet = moduleWorkbook.worksheets[0];
    const targetSheet = workbook.addWorksheet(title);

    if (!sourceSheet) {
      targetSheet.addRow([`RMH Advisors Pvt Ltd - ${title}`]);
      targetSheet.addRow([]);
      targetSheet.addRow(['Module data will be available soon']);
      return;
    }

    // Copy column widths
    sourceSheet.columns.forEach((column, index) => {
      const width = column.width ?? 18;
      targetSheet.getColumn(index + 1).width = width;
    });

    // Copy rows, cell values, and styles (fonts, fills, borders, alignment, number formats)
    sourceSheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const targetRow = targetSheet.getRow(rowNumber);
      if (row.height != null) {
        targetRow.height = row.height;
      }
      if (row.outlineLevel != null) {
        targetRow.outlineLevel = row.outlineLevel;
      }
      if (row.hidden != null) {
        targetRow.hidden = row.hidden;
      }

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const targetCell = targetRow.getCell(colNumber);
        targetCell.value = cell.value as ExcelJS.CellValue;
        // Copy full style object so that colors, borders, alignment, and hyperlink styling are preserved
        targetCell.style = { ...cell.style };
      });
    });

    // Copy merged cell ranges so that section headers and titles remain merged
    const sourceModel = (sourceSheet as any).model;
    if (sourceModel && Array.isArray(sourceModel.merges)) {
      sourceModel.merges.forEach((mergeRange: string) => {
        targetSheet.mergeCells(mergeRange);
      });
    }

    if (sourceSheet.properties.outlineProperties) {
      targetSheet.properties.outlineProperties = { ...sourceSheet.properties.outlineProperties };
    }

    applyConsistentSheetFormatting(targetSheet);
    this.applyNavHyperlinks(targetSheet, title);
  }

  /**
   * Generic Excel generator for modules without specific implementation
   */
  private async generateGenericModule(moduleName: string, report: AnalysisReport): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    const label = moduleName
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
    const worksheet = workbook.addWorksheet(label);

    worksheet.addRow([`RMH Advisors Pvt Ltd - ${label}`]);
    worksheet.mergeCells('A1:D1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    worksheet.addRow(['Module data will be available soon']);

    worksheet.columns.forEach(column => {
      column.width = 25;
    });

    return workbook;
  }
}

export const excelGenerator = new ExcelGeneratorService();
