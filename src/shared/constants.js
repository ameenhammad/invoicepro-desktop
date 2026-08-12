// IPC Channel Names
export const IPC_CHANNELS = {
  AUTH: {
    LOGIN: "auth:login",
    LOGOUT: "auth:logout",
    CHECK: "auth:check",
    GET_SETTINGS: "auth:get-settings",
    UPDATE_SETTINGS: "auth:update-settings",
    CHANGE_PASSWORD: "auth:change-password",
  },
  PRODUCTS: {
    GET_ALL: "products:get-all",
    GET: "products:get",
    CREATE: "products:create",
    UPDATE: "products:update",
    DELETE: "products:delete",
    GET_WITH_VARIANTS: "products:get-with-variants",
    ADD_VARIANT: "products:add-variant",
    UPDATE_VARIANT: "products:update-variant",
    DELETE_VARIANT: "products:delete-variant",
    GET_VARIANTS: "products:get-variants",
    ADJUST_STOCK: "products:adjust-stock",
  },
  CLIENTS: {
    GET_ALL: "clients:get-all",
    GET: "clients:get",
    CREATE: "clients:create",
    UPDATE: "clients:update",
    DELETE: "clients:delete",
  },
  INVOICES: {
    GET_ALL: "invoices:get-all",
    GET: "invoices:get",
    CREATE: "invoices:create",
    UPDATE: "invoices:update",
    DELETE: "invoices:delete",
    GENERATE_PDF: "invoices:generate-pdf",
    NEXT_NUMBER: "invoices:next-number",
  },
  PAYMENTS: {
    GET_BY_INVOICE: "payments:get-by-invoice",
    CREATE: "payments:create",
    DELETE: "payments:delete",
  },
  SERVICES: {
    GET_ALL: "services:get-all",
    GET: "services:get",
    CREATE: "services:create",
    UPDATE: "services:update",
    DELETE: "services:delete",
  },
  SETTINGS: {
    GET_APP_SETTINGS: "settings:get-app-settings",
    UPDATE_APP_SETTINGS: "settings:update-app-settings",
  },
  REPORTS: {
    SUMMARY: "reports:summary",
    REVENUE: "reports:revenue",
    PENDING: "reports:pending",
    SALES_ANALYTICS: "reports:sales-analytics",
    TOP_PRODUCTS: "reports:top-products",
    TOP_SERVICES: "reports:top-services",
    STOCK_LEVELS: "reports:stock-levels",
    LOW_STOCK: "reports:low-stock",
    SERVICE_REVENUE: "reports:service-revenue",
    HARDWARE_REVENUE: "reports:hardware-revenue",
    SERVICE_SALES_BY_TYPE: "reports:service-sales-by-type",
    HARDWARE_SALES_BY_PRODUCT: "reports:hardware-sales-by-product",
    STOCK_MOVEMENTS: "reports:stock-movements",
    INVENTORY_VALUE: "reports:inventory-value",
    WORKSHOP_SUMMARY: "reports:workshop-summary",
    PURCHASES_SUMMARY: "reports:purchases-summary",
    PURCHASES_BY_SUPPLIER: "reports:purchases-by-supplier",
    PURCHASES_BY_MONTH: "reports:purchases-by-month",
    WAGES_SUMMARY: "reports:wages-summary",
    WAGES_BY_WORKER: "reports:wages-by-worker",
    WAGES_BY_MONTH: "reports:wages-by-month",
    PROJECT_LABOUR_COST: "reports:project-labour-cost",
    STOCK_RECEIVED: "reports:stock-received",
    INCOME_BREAKDOWN: "reports:income-breakdown",
    SERVICE_SALES_BY_MONTH: "reports:service-sales-by-month",
    DATA_INTEGRITY_CHECK: "reports:data-integrity-check",
  },
  EXPENSES: {
    GET_ALL: "expenses:get-all",
    GET: "expenses:get",
    CREATE: "expenses:create",
    UPDATE: "expenses:update",
    DELETE: "expenses:delete",
  },
  CASHFLOW: {
    SUMMARY: "cashflow:summary",
    DASHBOARD: "cashflow:dashboard",
    TRANSACTIONS: "cashflow:transactions",
    INCOME_BY_SOURCE: "cashflow:income-by-source",
    EXPENSES_BY_CATEGORY: "cashflow:expenses-by-category",
    BY_PAYMENT_METHOD: "cashflow:by-payment-method",
  },
  PROJECTS: {
    GET_ALL: "projects:get-all",
    GET: "projects:get",
    CREATE: "projects:create",
    UPDATE: "projects:update",
    DELETE: "projects:delete",
    DASHBOARD_SUMMARY: "projects:dashboard-summary",
  },
  SUPPLIERS: {
    GET_ALL: "suppliers:get-all",
    GET: "suppliers:get",
    CREATE: "suppliers:create",
    UPDATE: "suppliers:update",
    DELETE: "suppliers:delete",
  },
  PURCHASES: {
    GET_ALL: "purchases:get-all",
    GET: "purchases:get",
    CREATE: "purchases:create",
    NEXT_NUMBER: "purchases:next-number",
    DASHBOARD_SUMMARY: "purchases:dashboard-summary",
  },
  PURCHASE_PAYMENTS: {
    GET_BY_PURCHASE: "purchase-payments:get-by-purchase",
    CREATE: "purchase-payments:create",
    DELETE: "purchase-payments:delete",
  },
  WORKERS: {
    GET_ALL: "workers:get-all",
    GET: "workers:get",
    CREATE: "workers:create",
    UPDATE: "workers:update",
    DELETE: "workers:delete",
    DASHBOARD_SUMMARY: "workers:dashboard-summary",
  },
  BACKUP: {
    CHOOSE_DESTINATION: "backup:choose-destination",
    CREATE: "backup:create",
    CHOOSE_RESTORE_FILE: "backup:choose-restore-file",
    VALIDATE_RESTORE_FILE: "backup:validate-restore-file",
    RESTORE: "backup:restore",
    LIST_AUTO_BACKUPS: "backup:list-auto-backups",
  },
};

// Invoice Status
export const INVOICE_STATUS = {
  DRAFT: "draft",
  PENDING: "pending",
  PARTIAL: "partial",
  PAID: "paid",
  CANCELLED: "cancelled",
};

// Payment Methods
export const PAYMENT_METHODS = {
  CASH: "cash",
  CHECK: "check",
  BANK_TRANSFER: "bank_transfer",
  CARD: "card",
};

// Default Admin Credentials
export const DEFAULT_ADMIN = {
  USERNAME: "admin",
  PASSWORD: "admin123",
};

// Session
export const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// Currency
export const CURRENCY_SYMBOL = "Rs.";
export const CURRENCY_CODE = "PKR";

// Hardware inventory categories — what's actually sold to walk-in customers
// (screws, hinges, handles, locks, channels...), not workshop raw materials.
export const PRODUCT_CATEGORIES = [
  "Screws",
  "Hinges",
  "Handles",
  "Locks",
  "Channels",
  "Accessories",
  "Other",
];

// Units a service can be sold by — "8 sheets", "120 running ft", etc.
export const SERVICE_UNITS = ["Sheet", "Sq Ft", "Running Ft", "Piece", "Job"];

// Services seeded on first run — invoiceable, never affect stock.
export const DEFAULT_SERVICES = [
  {
    name: "Sheet Cutting",
    description: "Cutting service for sheet materials",
    price: 0,
    unit: "Sheet",
  },
  {
    name: "Edge Banding",
    description: "Edge banding service",
    price: 0,
    unit: "Running Ft",
  },
];

// App-wide workshop settings, seeded once (see Database.ensureAppSettings) —
// stored in the key/value `settings` table and editable from the Settings page.
export const DEFAULT_APP_SETTINGS = {
  default_payment_method: PAYMENT_METHODS.CASH,
  invoice_prefix: "INV",
  currency_symbol: CURRENCY_SYMBOL,
  tax_rate: "0",
};

// Cash ledger (cash_transactions) — see src/main/ledger.js. Every actual
// cash movement posts exactly one row here; documents (invoices, and later
// expenses/purchases) never post directly, only their settlement rows do.
export const CASH_DIRECTION = {
  IN: "in",
  OUT: "out",
};

// business = the workshop; personal is reserved for a later phase, but the
// column exists now so business figures are never mixed with it by default.
export const CASH_SCOPE = {
  BUSINESS: "business",
  PERSONAL: "personal",
};

// What kind of settlement row produced this ledger entry. Wage payments
// have no source type of their own — they're expenses with a worker_id,
// so they post as CASH_SOURCE_TYPE.EXPENSE like any other expense.
export const CASH_SOURCE_TYPE = {
  INVOICE_PAYMENT: "invoice_payment",
  EXPENSE: "expense",
  PURCHASE_PAYMENT: "purchase_payment",
};

// Expenses (see src/main/ipc/expenses.ipc.js). A workshop-flavored fixed
// list, same normalize-to-"Other" pattern as PRODUCT_CATEGORIES.
export const EXPENSE_CATEGORIES = [
  "Materials",
  "Hardware Purchase",
  "Worker Wages",
  "Rent",
  "Electricity",
  "Transportation",
  "Machine Maintenance",
  "Workshop Maintenance",
  "Office/Admin",
  "Other",
];

// Whether an expense has actually been paid yet. Only 'paid' expenses have
// a ledger entry — mirrors invoices' draft/pending vs. paid distinction,
// but simpler since expenses don't support partial settlement this phase.
export const EXPENSE_STATUS = {
  UNPAID: "unpaid",
  PAID: "paid",
};

// Woodwork Projects (see src/main/ipc/projects.ipc.js). Same
// normalize-to-"Other" pattern as PRODUCT_CATEGORIES/EXPENSE_CATEGORIES.
export const PROJECT_TYPES = [
  "Doors",
  "Wardrobes",
  "Kitchens",
  "Ceilings",
  "Media Walls",
  "Custom Woodwork",
  "Other",
];

export const PROJECT_STATUS = {
  QUOTATION: "quotation",
  CONFIRMED: "confirmed",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
};

// Stock movements (see src/main/stock.js) — every quantity change on a
// product_variant is logged with exactly one of these reasons, and
// stock.js's recordStockMovement() is the only code path allowed to write
// product_variants.quantity.
export const STOCK_MOVEMENT_REASON = {
  STOCK_IN: "stock_in",
  STOCK_OUT: "stock_out",
  SALE: "sale",
  ADJUSTMENT: "adjustment",
};

// Purchases (see src/main/ipc/purchases.ipc.js) — a supplier receipt that
// increases stock via recordStockMovement() and, once paid, posts to the
// ledger exactly like an invoice payment does. No 'partial' at creation —
// that only happens once an actual partial payment is recorded.
export const PURCHASE_STATUS = {
  UNPAID: "unpaid",
  PARTIAL: "partial",
  PAID: "paid",
};

// Workers (see src/main/ipc/workers.ipc.js). Wage *payments* are not a
// separate ledger path — they're expenses with worker_id set, reusing
// Phase 2's expense/ledger machinery entirely.
export const WAGE_TYPE = {
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  PER_JOB: "per_job",
  OTHER: "other",
};
