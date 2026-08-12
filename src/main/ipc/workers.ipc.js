import { ipcMain } from "electron";
import { IPC_CHANNELS, WAGE_TYPE } from "../../shared/constants.js";
import { requireAuth, safe } from "./helpers.js";

function normalizeWageType(type) {
  return Object.values(WAGE_TYPE).includes(type) ? type : WAGE_TYPE.DAILY;
}

// Workers themselves are a simple catalog (soft-deleted, like clients).
// Wage *payments* are NOT handled here — recording a payment to a worker is
// just creating an expense (category "Worker Wages", worker_id set), which
// reuses Phase 2's expense/ledger machinery entirely. See expenses.ipc.js.
export function registerWorkerHandlers(db) {
  ipcMain.handle(
    IPC_CHANNELS.WORKERS.GET_ALL,
    safe((event, token, search) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      let sql = "SELECT * FROM workers WHERE is_active = 1";
      const params = [];
      if (search) {
        sql += " AND (name LIKE ? OR role LIKE ?)";
        const term = `%${search}%`;
        params.push(term, term);
      }
      sql += " ORDER BY name ASC";

      return { success: true, data: db.all(sql, params) };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.WORKERS.GET,
    safe((event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const worker = db.get("SELECT * FROM workers WHERE id = ?", [id]);
      if (!worker)
        return { success: false, error: { code: "NOT_FOUND", message: "Worker not found" } };

      const wagesPaid = db.get(
        `SELECT COALESCE(SUM(e.amount), 0) as v FROM expenses e WHERE e.worker_id = ? AND e.status = 'paid'`,
        [id],
      ).v;
      const recentPayments = db.all(
        `SELECT * FROM expenses WHERE worker_id = ? ORDER BY expense_date DESC, id DESC LIMIT 10`,
        [id],
      );

      return { success: true, data: { ...worker, wagesPaid, recentPayments } };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.WORKERS.CREATE,
    safe((event, token, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const { name, phone, role, wage_type, default_rate, notes } = data || {};
      if (!name)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Worker name is required" } };

      const rate = parseFloat(default_rate) || 0;
      if (rate < 0)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Default rate cannot be negative" } };

      const result = db.run(
        "INSERT INTO workers (name, phone, role, wage_type, default_rate, notes) VALUES (?, ?, ?, ?, ?, ?)",
        [name, phone || "", role || "", normalizeWageType(wage_type), rate, notes || ""],
      );

      return { success: true, data: { id: result.lastInsertRowid } };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.WORKERS.UPDATE,
    safe((event, token, id, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const { name, phone, role, wage_type, default_rate, is_active, notes } = data || {};
      if (!name)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Worker name is required" } };

      const rate = parseFloat(default_rate) || 0;
      if (rate < 0)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Default rate cannot be negative" } };

      db.run(
        "UPDATE workers SET name = ?, phone = ?, role = ?, wage_type = ?, default_rate = ?, is_active = ?, notes = ? WHERE id = ?",
        [name, phone || "", role || "", normalizeWageType(wage_type), rate, is_active ?? 1, notes || "", id],
      );

      return { success: true, data: db.get("SELECT * FROM workers WHERE id = ?", [id]) };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.WORKERS.DELETE,
    safe((event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      db.run("UPDATE workers SET is_active = 0 WHERE id = ?", [id]);
      return { success: true };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.WORKERS.DASHBOARD_SUMMARY,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      // "Worker Payments" = actual cash paid (ledger-based, via expenses
      // that have posted). "Worker/Wage Expenses" = accrued total, whether
      // or not it's been paid yet — same distinction as Phase 2's
      // amountReceived vs invoiced.
      const workerPayments = db.get(
        `SELECT COALESCE(SUM(ct.amount), 0) as v
         FROM cash_transactions ct
         JOIN expenses e ON ct.source_type = 'expense' AND ct.source_id = e.id
         WHERE e.worker_id IS NOT NULL AND ct.direction = 'out'`,
      ).v;

      const wageExpenses = db.get(
        "SELECT COALESCE(SUM(amount), 0) as v FROM expenses WHERE worker_id IS NOT NULL",
      ).v;

      const recentWagePayments = db.all(
        `SELECT e.id, e.amount, e.expense_date, e.status, w.name as worker_name
         FROM expenses e JOIN workers w ON w.id = e.worker_id
         ORDER BY e.expense_date DESC, e.id DESC LIMIT 8`,
      );

      return { success: true, data: { workerPayments, wageExpenses, recentWagePayments } };
    }),
  );
}
