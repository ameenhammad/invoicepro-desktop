const { contextBridge, ipcRenderer } = require("electron");

// Define allowed IPC channels
const validChannels = [
  "auth:login",
  "auth:logout",
  "auth:check",
  "auth:get-settings",
  "auth:update-settings",
  "products:get-all",
  "products:get",
  "products:create",
  "products:update",
  "products:delete",
  "clients:get-all",
  "clients:get",
  "clients:create",
  "clients:update",
  "clients:delete",
  "invoices:get-all",
  "invoices:get",
  "invoices:create",
  "invoices:update",
  "invoices:delete",
  "invoices:generate-pdf",
  "invoices:next-number",
  "payments:get-by-invoice",
  "payments:create",
  "payments:delete",
  "reports:summary",
  "reports:revenue",
  "reports:pending",
  "dialog:save-file",
  "file:write-pdf",
];

contextBridge.exposeInMainWorld("api", {
  invoke: (channel, ...args) => {
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    throw new Error(`Invalid IPC channel: ${channel}`);
  },

  // Auth
  auth: {
    login: (username, password) =>
      ipcRenderer.invoke("auth:login", username, password),
    logout: () => ipcRenderer.invoke("auth:logout"),
    check: () => ipcRenderer.invoke("auth:check"),
    getSettings: () => ipcRenderer.invoke("auth:get-settings"),
    updateSettings: (settings) =>
      ipcRenderer.invoke("auth:update-settings", settings),
  },

  // Products
  products: {
    getAll: () => ipcRenderer.invoke("products:get-all"),
    get: (id) => ipcRenderer.invoke("products:get", id),
    create: (data) => ipcRenderer.invoke("products:create", data),
    update: (id, data) => ipcRenderer.invoke("products:update", id, data),
    delete: (id) => ipcRenderer.invoke("products:delete", id),
  },

  // Clients
  clients: {
    getAll: () => ipcRenderer.invoke("clients:get-all"),
    get: (id) => ipcRenderer.invoke("clients:get", id),
    create: (data) => ipcRenderer.invoke("clients:create", data),
    update: (id, data) => ipcRenderer.invoke("clients:update", id, data),
    delete: (id) => ipcRenderer.invoke("clients:delete", id),
  },

  // Invoices
  invoices: {
    getAll: () => ipcRenderer.invoke("invoices:get-all"),
    get: (id) => ipcRenderer.invoke("invoices:get", id),
    create: (data) => ipcRenderer.invoke("invoices:create", data),
    update: (id, data) => ipcRenderer.invoke("invoices:update", id, data),
    delete: (id) => ipcRenderer.invoke("invoices:delete", id),
    generatePdf: (id) => ipcRenderer.invoke("invoices:generate-pdf", id),
    nextNumber: () => ipcRenderer.invoke("invoices:next-number"),
  },

  // Payments
  payments: {
    getByInvoice: (invoiceId) =>
      ipcRenderer.invoke("payments:get-by-invoice", invoiceId),
    create: (data) => ipcRenderer.invoke("payments:create", data),
    delete: (id) => ipcRenderer.invoke("payments:delete", id),
  },

  // Reports
  reports: {
    summary: () => ipcRenderer.invoke("reports:summary"),
    revenue: (filters) => ipcRenderer.invoke("reports:revenue", filters),
    pending: () => ipcRenderer.invoke("reports:pending"),
  },

  // Dialog
  dialog: {
    saveFile: (options) => ipcRenderer.invoke("dialog:save-file", options),
    writePdf: (filePath, buffer) =>
      ipcRenderer.invoke("file:write-pdf", { filePath, buffer }),
  },
});
