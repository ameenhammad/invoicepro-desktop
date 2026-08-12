import log from "electron-log";
import { registerAuthHandlers } from "./auth.ipc.js";
import { registerProductHandlers } from "./products.ipc.js";
import { registerClientHandlers } from "./clients.ipc.js";
import { registerInvoiceHandlers } from "./invoices.ipc.js";
import { registerPaymentHandlers } from "./payments.ipc.js";
import { registerServiceHandlers } from "./services.ipc.js";
import { registerSettingsHandlers } from "./settings.ipc.js";
import { registerReportHandlers } from "./reports.ipc.js";
import { registerExpenseHandlers } from "./expenses.ipc.js";
import { registerCashflowHandlers } from "./cashflow.ipc.js";
import { registerProjectHandlers } from "./projects.ipc.js";
import { registerSupplierHandlers } from "./suppliers.ipc.js";
import { registerPurchaseHandlers } from "./purchases.ipc.js";
import { registerPurchasePaymentHandlers } from "./purchase-payments.ipc.js";
import { registerWorkerHandlers } from "./workers.ipc.js";

export function setupIpcHandlers(db) {
  registerAuthHandlers(db);
  registerProductHandlers(db);
  registerClientHandlers(db);
  registerInvoiceHandlers(db);
  registerPaymentHandlers(db);
  registerServiceHandlers(db);
  registerSettingsHandlers(db);
  registerReportHandlers(db);
  registerExpenseHandlers(db);
  registerCashflowHandlers(db);
  registerProjectHandlers(db);
  registerSupplierHandlers(db);
  registerPurchaseHandlers(db);
  registerPurchasePaymentHandlers(db);
  registerWorkerHandlers(db);

  log.info("IPC handlers registered");
}
