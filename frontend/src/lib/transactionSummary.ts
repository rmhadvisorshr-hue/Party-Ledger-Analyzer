// Re-exports the canonical party-summary pipeline from the server analysis module so the
// browser table and every Excel export are always driven by the exact same logic.
export * from "../../../backend/src/analysis/transactionSummary";
