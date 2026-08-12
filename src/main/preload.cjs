const { contextBridge, ipcRenderer } = require("electron");

// Electron loads preload scripts via CommonJS regardless of the project's
// "type": "module" setting, so this file must stay CommonJS (.cjs).

contextBridge.exposeInMainWorld("api", {
  // Auth — login/logout/check are public; the rest need a token
  auth: {
    login: (username, password) =>
      ipcRenderer.invoke("auth:login", username, password),
    logout: (token) => ipcRenderer.invoke("auth:logout", token),
    check: (token) => ipcRenderer.invoke("auth:check", token),
    getSettings: (token) => ipcRenderer.invoke("auth:get-settings", token),
    updateSettings: (token, settings) =>
      ipcRenderer.invoke("auth:update-settings", token, settings),
    changePassword: (token, currentPassword, newPassword) =>
      ipcRenderer.invoke(
        "auth:change-password",
        token,
        currentPassword,
        newPassword,
      ),
  },

  // Products — all require token
  products: {
    getAll: (token, search) =>
      ipcRenderer.invoke("products:get-all", token, search),
    get: (token, id) => ipcRenderer.invoke("products:get", token, id),
    create: (token, data) => ipcRenderer.invoke("products:create", token, data),
    update: (token, id, data) =>
      ipcRenderer.invoke("products:update", token, id, data),
    delete: (token, id) => ipcRenderer.invoke("products:delete", token, id),
    getWithVariants: (token, id) =>
      ipcRenderer.invoke("products:get-with-variants", token, id),
    addVariant: (token, data) =>
      ipcRenderer.invoke("products:add-variant", token, data),
    updateVariant: (token, id, data) =>
      ipcRenderer.invoke("products:update-variant", token, id, data),
    deleteVariant: (token, id) =>
      ipcRenderer.invoke("products:delete-variant", token, id),
    getVariants: (token, productId) =>
      ipcRenderer.invoke("products:get-variants", token, productId),
    adjustStock: (token, data) =>
      ipcRenderer.invoke("products:adjust-stock", token, data),
  },

  // Clients — all require token
  clients: {
    getAll: (token, search) =>
      ipcRenderer.invoke("clients:get-all", token, search),
    get: (token, id) => ipcRenderer.invoke("clients:get", token, id),
    create: (token, data) => ipcRenderer.invoke("clients:create", token, data),
    update: (token, id, data) =>
      ipcRenderer.invoke("clients:update", token, id, data),
    delete: (token, id) => ipcRenderer.invoke("clients:delete", token, id),
  },

  // Invoices — all require token
  invoices: {
    getAll: (token, filters) =>
      ipcRenderer.invoke("invoices:get-all", token, filters),
    get: (token, id) => ipcRenderer.invoke("invoices:get", token, id),
    create: (token, data) => ipcRenderer.invoke("invoices:create", token, data),
    update: (token, id, data) =>
      ipcRenderer.invoke("invoices:update", token, id, data),
    delete: (token, id) => ipcRenderer.invoke("invoices:delete", token, id),
    generatePdf: (token, id) =>
      ipcRenderer.invoke("invoices:generate-pdf", token, id),
    nextNumber: (token) => ipcRenderer.invoke("invoices:next-number", token),
  },

  // Payments — all require token
  payments: {
    getByInvoice: (token, invoiceId) =>
      ipcRenderer.invoke("payments:get-by-invoice", token, invoiceId),
    create: (token, data) => ipcRenderer.invoke("payments:create", token, data),
    delete: (token, id) => ipcRenderer.invoke("payments:delete", token, id),
  },

  // Services — all require token
  services: {
    getAll: (token, search) =>
      ipcRenderer.invoke("services:get-all", token, search),
    get: (token, id) => ipcRenderer.invoke("services:get", token, id),
    create: (token, data) => ipcRenderer.invoke("services:create", token, data),
    update: (token, id, data) =>
      ipcRenderer.invoke("services:update", token, id, data),
    delete: (token, id) => ipcRenderer.invoke("services:delete", token, id),
  },

  // App-wide workshop settings — all require token
  settings: {
    getAppSettings: (token) =>
      ipcRenderer.invoke("settings:get-app-settings", token),
    updateAppSettings: (token, updates) =>
      ipcRenderer.invoke("settings:update-app-settings", token, updates),
  },

  // Reports — all require token
  reports: {
    summary: (token) => ipcRenderer.invoke("reports:summary", token),
    revenue: (token, filters) =>
      ipcRenderer.invoke("reports:revenue", token, filters),
    pending: (token) => ipcRenderer.invoke("reports:pending", token),
    salesAnalytics: (token, period) =>
      ipcRenderer.invoke("reports:sales-analytics", token, period),
    topProducts: (token, limit) =>
      ipcRenderer.invoke("reports:top-products", token, limit),
    topServices: (token, limit) =>
      ipcRenderer.invoke("reports:top-services", token, limit),
    stockLevels: (token) => ipcRenderer.invoke("reports:stock-levels", token),
    lowStock: (token) => ipcRenderer.invoke("reports:low-stock", token),
    serviceRevenue: (token) => ipcRenderer.invoke("reports:service-revenue", token),
    hardwareRevenue: (token) => ipcRenderer.invoke("reports:hardware-revenue", token),
    serviceSalesByType: (token) =>
      ipcRenderer.invoke("reports:service-sales-by-type", token),
    hardwareSalesByProduct: (token) =>
      ipcRenderer.invoke("reports:hardware-sales-by-product", token),
    stockMovements: (token, filters) =>
      ipcRenderer.invoke("reports:stock-movements", token, filters),
    inventoryValue: (token) => ipcRenderer.invoke("reports:inventory-value", token),
    workshopSummary: (token) => ipcRenderer.invoke("reports:workshop-summary", token),
    purchasesSummary: (token) => ipcRenderer.invoke("reports:purchases-summary", token),
    purchasesBySupplier: (token) => ipcRenderer.invoke("reports:purchases-by-supplier", token),
    purchasesByMonth: (token) => ipcRenderer.invoke("reports:purchases-by-month", token),
    wagesSummary: (token) => ipcRenderer.invoke("reports:wages-summary", token),
    wagesByWorker: (token) => ipcRenderer.invoke("reports:wages-by-worker", token),
    wagesByMonth: (token) => ipcRenderer.invoke("reports:wages-by-month", token),
    projectLabourCost: (token) => ipcRenderer.invoke("reports:project-labour-cost", token),
    stockReceived: (token) => ipcRenderer.invoke("reports:stock-received", token),
    incomeBreakdown: (token, filters) =>
      ipcRenderer.invoke("reports:income-breakdown", token, filters),
    serviceSalesByMonth: (token) =>
      ipcRenderer.invoke("reports:service-sales-by-month", token),
    dataIntegrityCheck: (token) =>
      ipcRenderer.invoke("reports:data-integrity-check", token),
  },

  // Expenses — all require token
  expenses: {
    getAll: (token, filters) =>
      ipcRenderer.invoke("expenses:get-all", token, filters),
    get: (token, id) => ipcRenderer.invoke("expenses:get", token, id),
    create: (token, data) => ipcRenderer.invoke("expenses:create", token, data),
    update: (token, id, data) =>
      ipcRenderer.invoke("expenses:update", token, id, data),
    delete: (token, id) => ipcRenderer.invoke("expenses:delete", token, id),
  },

  // Cash flow — read-only views over the cash_transactions ledger
  cashflow: {
    summary: (token, filters) =>
      ipcRenderer.invoke("cashflow:summary", token, filters),
    dashboard: (token) => ipcRenderer.invoke("cashflow:dashboard", token),
    transactions: (token, filters) =>
      ipcRenderer.invoke("cashflow:transactions", token, filters),
    incomeBySource: (token, filters) =>
      ipcRenderer.invoke("cashflow:income-by-source", token, filters),
    expensesByCategory: (token, filters) =>
      ipcRenderer.invoke("cashflow:expenses-by-category", token, filters),
    byPaymentMethod: (token, filters) =>
      ipcRenderer.invoke("cashflow:by-payment-method", token, filters),
  },

  // Projects — all require token
  projects: {
    getAll: (token, filters) =>
      ipcRenderer.invoke("projects:get-all", token, filters),
    get: (token, id) => ipcRenderer.invoke("projects:get", token, id),
    create: (token, data) => ipcRenderer.invoke("projects:create", token, data),
    update: (token, id, data) =>
      ipcRenderer.invoke("projects:update", token, id, data),
    delete: (token, id) => ipcRenderer.invoke("projects:delete", token, id),
    dashboardSummary: (token) =>
      ipcRenderer.invoke("projects:dashboard-summary", token),
  },

  // Suppliers — all require token
  suppliers: {
    getAll: (token, search) =>
      ipcRenderer.invoke("suppliers:get-all", token, search),
    get: (token, id) => ipcRenderer.invoke("suppliers:get", token, id),
    create: (token, data) => ipcRenderer.invoke("suppliers:create", token, data),
    update: (token, id, data) =>
      ipcRenderer.invoke("suppliers:update", token, id, data),
    delete: (token, id) => ipcRenderer.invoke("suppliers:delete", token, id),
  },

  // Purchases — all require token
  purchases: {
    getAll: (token, filters) =>
      ipcRenderer.invoke("purchases:get-all", token, filters),
    get: (token, id) => ipcRenderer.invoke("purchases:get", token, id),
    create: (token, data) => ipcRenderer.invoke("purchases:create", token, data),
    nextNumber: (token) => ipcRenderer.invoke("purchases:next-number", token),
    dashboardSummary: (token) =>
      ipcRenderer.invoke("purchases:dashboard-summary", token),
  },

  // Purchase payments — all require token
  purchasePayments: {
    getByPurchase: (token, purchaseId) =>
      ipcRenderer.invoke("purchase-payments:get-by-purchase", token, purchaseId),
    create: (token, data) =>
      ipcRenderer.invoke("purchase-payments:create", token, data),
    delete: (token, id) =>
      ipcRenderer.invoke("purchase-payments:delete", token, id),
  },

  // Workers — all require token
  workers: {
    getAll: (token, search) =>
      ipcRenderer.invoke("workers:get-all", token, search),
    get: (token, id) => ipcRenderer.invoke("workers:get", token, id),
    create: (token, data) => ipcRenderer.invoke("workers:create", token, data),
    update: (token, id, data) =>
      ipcRenderer.invoke("workers:update", token, id, data),
    delete: (token, id) => ipcRenderer.invoke("workers:delete", token, id),
    dashboardSummary: (token) =>
      ipcRenderer.invoke("workers:dashboard-summary", token),
  },

  // Dialog — no token needed (OS-level dialogs)
  dialog: {
    saveFile: (options) => ipcRenderer.invoke("dialog:save-file", options),
    writePdf: (filePath, buffer) =>
      ipcRenderer.invoke("file:write-pdf", { filePath, buffer }),
  },

  // Backup & Restore — dialog steps need no token; the actual data
  // operations (create/restore) do.
  backup: {
    chooseDestination: () => ipcRenderer.invoke("backup:choose-destination"),
    create: (token, destinationPath) =>
      ipcRenderer.invoke("backup:create", token, destinationPath),
    chooseRestoreFile: () => ipcRenderer.invoke("backup:choose-restore-file"),
    validateRestoreFile: (token, filePath) =>
      ipcRenderer.invoke("backup:validate-restore-file", token, filePath),
    listAutoBackups: (token) =>
      ipcRenderer.invoke("backup:list-auto-backups", token),
    restore: (token, filePath) =>
      ipcRenderer.invoke("backup:restore", token, filePath),
  },

  // Print — trigger the OS print dialog for the current window
  print: () => window.print(),
});
