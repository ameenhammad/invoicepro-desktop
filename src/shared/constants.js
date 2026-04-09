module.exports = {
  // IPC Channel Names
  IPC_CHANNELS: {
    AUTH: {
      LOGIN: "auth:login",
      LOGOUT: "auth:logout",
      CHECK: "auth:check",
      GET_SETTINGS: "auth:get-settings",
      UPDATE_SETTINGS: "auth:update-settings",
    },
    PRODUCTS: {
      GET_ALL: "products:get-all",
      GET: "products:get",
      CREATE: "products:create",
      UPDATE: "products:update",
      DELETE: "products:delete",
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
    REPORTS: {
      SUMMARY: "reports:summary",
      REVENUE: "reports:revenue",
      PENDING: "reports:pending",
    },
  },

  // Invoice Status
  INVOICE_STATUS: {
    DRAFT: "draft",
    PENDING: "pending",
    PARTIAL: "partial",
    PAID: "paid",
    CANCELLED: "cancelled",
  },

  // Payment Methods
  PAYMENT_METHODS: {
    CASH: "cash",
    CHECK: "check",
    BANK_TRANSFER: "bank_transfer",
    CARD: "card",
  },

  // Default Admin Credentials
  DEFAULT_ADMIN: {
    USERNAME: "admin",
    PASSWORD: "admin123",
  },

  // Session
  SESSION_EXPIRY_MS: 24 * 60 * 60 * 1000, // 24 hours

  // Database
  DATABASE_PATH: "data/invoicepro.db",
};
