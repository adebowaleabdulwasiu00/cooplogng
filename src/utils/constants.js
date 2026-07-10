export const TRANSACTION_TYPES = [
    "Unknown Payments",
    "Admin Expenses",
    "Staff & Management Expenses",
    "Meeting & Member Activities",
    "AGM Expenses",
    "Financial & Banking Expenses",
    "Utilities & Operations",
    "Transport & Logistics",
    "Loans & Credit Operations",
    "Asset & Equipment",
    "General Purchase",
    "Levies, Fee & Subscription",
    "Registration Fee",
    "Misc. Expenses",
    "Member Deposit",
    "Member Welfare",
    "Member Loan",
    "Loan Charges",
    "Savings Withdrawal",
    "Special Income",
    "Internal Transfer",
    "Other Income",
    "Other Expenses"
];

export const CLASSIFICATION_OPTIONS = [
    "Operating Income",
    "Loan Income",
    "Other Income",
    "Operating Expense",
    "Administrative Expense",
    "Finance Expense",
    "Welfare Expense",
    "Other Operating Expense",
    "Other Expenses",
    "Asset",
    "Fixed Asset",
    "Loan Asset",
    "Liability",
    "Member Liability",
    "Equity",
    "Transfer",
    "Suspense"
];

export const INCOME_CLASSIFICATIONS = new Set([
    "Operating Income",
    "Loan Income",
    "Other Income"
]);

export const EXPENSE_CLASSIFICATIONS = new Set([
    "Operating Expense",
    "Administrative Expense",
    "Finance Expense",
    "Welfare Expense",
    "Other Operating Expense",
    "Other Expenses"
]);

export const BALANCE_SHEET_CLASSIFICATIONS = new Set([
    "Asset",
    "Fixed Asset",
    "Loan Asset",
    "Liability",
    "Member Liability",
    "Equity"
]);

export function isIncomeClassification(classification) {
    return INCOME_CLASSIFICATIONS.has(classification);
}

export function isExpenseClassification(classification) {
    return EXPENSE_CLASSIFICATIONS.has(classification);
}

export function isPnLClassification(classification) {
    return isIncomeClassification(classification) || isExpenseClassification(classification);
}

export const DEFAULT_TRANSACTION_TYPES = [
    { name: "Unknown Payments", classification: "Suspense" },
    { name: "Admin Expenses", classification: "Administrative Expense" },
    { name: "Staff & Management Expenses", classification: "Administrative Expense" },
    { name: "Meeting & Member Activities", classification: "Operating Expense" },
    { name: "AGM Expenses", classification: "Operating Expense" },
    { name: "Financial & Banking Expenses", classification: "Finance Expense" },
    { name: "Utilities & Operations", classification: "Operating Expense" },
    { name: "Transport & Logistics", classification: "Operating Expense" },
    { name: "Loans & Credit Operations", classification: "Loan Asset" },
    { name: "Asset & Equipment", classification: "Fixed Asset" },
    { name: "General Purchase", classification: "Operating Expense" },
    { name: "Levies, Fee & Subscription", classification: "Operating Income" },
    { name: "Registration Fee", classification: "Operating Income" },
    { name: "Misc. Expenses", classification: "Other Operating Expense" },
    { name: "Member Deposit", classification: "Member Liability" },
    { name: "Member Welfare", classification: "Welfare Expense" },
    { name: "Member Loan", classification: "Loan Asset" },
    { name: "Loan Charges", classification: "Loan Income" },
    { name: "Savings Withdrawal", classification: "Member Liability" },
    { name: "Special Income", classification: "Other Income" },
    { name: "Internal Transfer", classification: "Transfer" },
    { name: "Other Income", classification: "Other Income" },
    { name: "Other Expenses", classification: "Other Expenses" }
];
