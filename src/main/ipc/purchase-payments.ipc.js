import { ipcMain } from "electron";
import { IPC_CHANNELS, PURCHASE_STATUS, CASH_DIRECTION, CASH_SCOPE, CASH_SOURCE_TYPE } from "../../shared/constants.js";
import { requireAuth, safe } from "./helpers.js";
import { postLedgerEntry, reverseLedgerEntry } from "../ledger.js";

// Exact mirror of recomputeInvoiceStatus in payments.ipc.js — status is a
// cached read derived from SUM(purchase_payments), never the source of
// truth for cash.
function recomputePurchaseStatus(db, purchaseId) {
  const purchase = db.get("SELECT * FROM purchases WHERE id = ?", [purchaseId]);
  const totalPaid =
    db.get(
      "SELECT COALESCE(SUM(amount), 0) as total FROM purchase_payments WHERE purchase_id = ?",
      [purchaseId],
    ).total || 0;

  let newStatus = PURCHASE_STATUS.UNPAID;
  if (totalPaid >= purchase.total) newStatus = PURCHASE_STATUS.PAID;
  else if (totalPaid > 0) newStatus = PURCHASE_STATUS.PARTIAL;

  db.run("UPDATE purchases SET status = ? WHERE id = ?", [newStatus, purchaseId]);
}

export function registerPurchasePaymentHandlers(db) {
  ipcMain.handle(
    IPC_CHANNELS.PURCHASE_PAYMENTS.GET_BY_PURCHASE,
    safe((event, token, purchaseId) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const payments = db.all(
        "SELECT * FROM purchase_payments WHERE purchase_id = ? ORDER BY payment_date DESC",
        [purchaseId],
      );
      return { success: true, data: payments };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.PURCHASE_PAYMENTS.CREATE,
    safe((event, token, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const { purchase_id, amount, payment_date, method, reference, notes } = data || {};
      if (!purchase_id)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Purchase is required" } };
      if (!amount || amount <= 0)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Amount must be positive" } };

      const purchase = db.get("SELECT id, purchase_number FROM purchases WHERE id = ?", [purchase_id]);
      if (!purchase)
        return { success: false, error: { code: "NOT_FOUND", message: "Purchase not found" } };

      const resolvedDate = payment_date || new Date().toISOString().split("T")[0];
      const resolvedMethod = method || "cash";

      // Payment row + ledger entry + status recompute all commit together,
      // same atomicity guarantee as invoice payments.
      const paymentId = db.transaction(() => {
        const result = db.run(
          "INSERT INTO purchase_payments (purchase_id, amount, payment_date, method, reference, notes) VALUES (?, ?, ?, ?, ?, ?)",
          [purchase_id, amount, resolvedDate, resolvedMethod, reference || "", notes || ""],
        );
        const newPaymentId = result.lastInsertRowid;

        postLedgerEntry(db, {
          direction: CASH_DIRECTION.OUT,
          scope: CASH_SCOPE.BUSINESS,
          amount,
          txnDate: resolvedDate,
          method: resolvedMethod,
          sourceType: CASH_SOURCE_TYPE.PURCHASE_PAYMENT,
          sourceId: newPaymentId,
          description: `Payment for purchase ${purchase.purchase_number}`,
        });

        recomputePurchaseStatus(db, purchase_id);
        return newPaymentId;
      })();

      return { success: true, data: { id: paymentId } };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.PURCHASE_PAYMENTS.DELETE,
    safe((event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const payment = db.get("SELECT * FROM purchase_payments WHERE id = ?", [id]);
      if (!payment)
        return { success: false, error: { code: "NOT_FOUND", message: "Payment not found" } };

      db.transaction(() => {
        db.run("DELETE FROM purchase_payments WHERE id = ?", [id]);
        reverseLedgerEntry(db, { sourceType: CASH_SOURCE_TYPE.PURCHASE_PAYMENT, sourceId: id });
        recomputePurchaseStatus(db, payment.purchase_id);
      })();

      return { success: true };
    }),
  );
}
