import { ipcMain } from "electron";
import { IPC_CHANNELS, INVOICE_STATUS, CASH_DIRECTION, CASH_SCOPE, CASH_SOURCE_TYPE } from "../../shared/constants.js";
import { requireAuth, safe } from "./helpers.js";
import { postLedgerEntry, reverseLedgerEntry } from "../ledger.js";

function recomputeInvoiceStatus(db, invoiceId) {
  const invoice = db.get("SELECT * FROM invoices WHERE id = ?", [invoiceId]);
  const totalPaid =
    db.get(
      "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE invoice_id = ?",
      [invoiceId],
    ).total || 0;

  let newStatus = INVOICE_STATUS.PENDING;
  if (totalPaid >= invoice.total) newStatus = INVOICE_STATUS.PAID;
  else if (totalPaid > 0) newStatus = INVOICE_STATUS.PARTIAL;

  db.run("UPDATE invoices SET status = ? WHERE id = ?", [newStatus, invoiceId]);
}

export function registerPaymentHandlers(db) {
  ipcMain.handle(
    IPC_CHANNELS.PAYMENTS.GET_BY_INVOICE,
    safe((event, token, invoiceId) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const payments = db.all(
        "SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC",
        [invoiceId],
      );
      return { success: true, data: payments };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.PAYMENTS.CREATE,
    safe((event, token, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const { invoice_id, amount, payment_date, method, reference, notes } =
        data;
      if (!invoice_id)
        return {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invoice is required" },
        };
      if (!amount || amount <= 0)
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Amount must be positive",
          },
        };

      const invoice = db.get(
        "SELECT id, invoice_number FROM invoices WHERE id = ?",
        [invoice_id],
      );
      if (!invoice)
        return {
          success: false,
          error: { code: "NOT_FOUND", message: "Invoice not found" },
        };

      const resolvedDate = payment_date || new Date().toISOString().split("T")[0];
      const resolvedMethod = method || "cash";

      // Payment row + ledger entry + status recompute all commit together —
      // if the ledger insert fails (e.g. a duplicate source_id), the payment
      // itself is rolled back too, so the two can never drift apart.
      const paymentId = db.transaction(() => {
        const result = db.run(
          "INSERT INTO payments (invoice_id, amount, payment_date, method, reference, notes) VALUES (?, ?, ?, ?, ?, ?)",
          [invoice_id, amount, resolvedDate, resolvedMethod, reference || "", notes || ""],
        );
        const newPaymentId = result.lastInsertRowid;

        postLedgerEntry(db, {
          direction: CASH_DIRECTION.IN,
          scope: CASH_SCOPE.BUSINESS,
          amount,
          txnDate: resolvedDate,
          method: resolvedMethod,
          sourceType: CASH_SOURCE_TYPE.INVOICE_PAYMENT,
          sourceId: newPaymentId,
          description: `Payment for invoice ${invoice.invoice_number}`,
        });

        recomputeInvoiceStatus(db, invoice_id);
        return newPaymentId;
      })();

      return { success: true, data: { id: paymentId } };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.PAYMENTS.DELETE,
    safe((event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const payment = db.get("SELECT * FROM payments WHERE id = ?", [id]);
      if (!payment)
        return {
          success: false,
          error: { code: "NOT_FOUND", message: "Payment not found" },
        };

      db.transaction(() => {
        db.run("DELETE FROM payments WHERE id = ?", [id]);
        reverseLedgerEntry(db, {
          sourceType: CASH_SOURCE_TYPE.INVOICE_PAYMENT,
          sourceId: id,
        });
        recomputeInvoiceStatus(db, payment.invoice_id);
      })();

      return { success: true };
    }),
  );
}
