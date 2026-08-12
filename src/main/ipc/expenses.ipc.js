import { ipcMain } from "electron";
import {
  IPC_CHANNELS,
  EXPENSE_CATEGORIES,
  EXPENSE_STATUS,
  CASH_DIRECTION,
  CASH_SCOPE,
  CASH_SOURCE_TYPE,
} from "../../shared/constants.js";
import { requireAuth, safe } from "./helpers.js";
import { postLedgerEntry, updateLedgerEntry, reverseLedgerEntry, toAccountingMonth } from "../ledger.js";

function normalizeCategory(category) {
  return EXPENSE_CATEGORIES.includes(category) ? category : "Other";
}

function normalizeScope(scope) {
  return scope === CASH_SCOPE.PERSONAL ? CASH_SCOPE.PERSONAL : CASH_SCOPE.BUSINESS;
}

function normalizeStatus(status) {
  return status === EXPENSE_STATUS.UNPAID ? EXPENSE_STATUS.UNPAID : EXPENSE_STATUS.PAID;
}

// Resolves the fields shared by create/update, applying the same
// today/normalize fallbacks products/payments already use elsewhere.
function resolveExpenseInput(data) {
  const amount = parseFloat(data.amount);
  const category = normalizeCategory(data.category);
  const expenseDate = data.expense_date || new Date().toISOString().split("T")[0];
  const accountingMonth =
    data.accounting_month && /^\d{4}-\d{2}$/.test(data.accounting_month)
      ? data.accounting_month
      : toAccountingMonth(expenseDate);
  const method = data.method || "cash";
  const scope = normalizeScope(data.scope);
  const status = normalizeStatus(data.status);
  const description = data.description || "";
  // Optional links to a woodwork project and/or a worker — validated by the
  // caller (existence needs a db lookup, which this pure function doesn't have).
  const projectId = data.project_id ?? null;
  const workerId = data.worker_id ?? null;

  return { amount, category, expenseDate, accountingMonth, method, scope, status, description, projectId, workerId };
}

function ledgerDescription(expense) {
  return expense.description || `${expense.category} expense`;
}

export function registerExpenseHandlers(db) {
  ipcMain.handle(
    IPC_CHANNELS.EXPENSES.GET_ALL,
    safe((event, token, filters) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      let sql = "SELECT * FROM expenses WHERE 1=1";
      const params = [];

      if (filters) {
        if (filters.scope) {
          sql += " AND scope = ?";
          params.push(filters.scope);
        }
        if (filters.category) {
          sql += " AND category = ?";
          params.push(filters.category);
        }
        if (filters.status) {
          sql += " AND status = ?";
          params.push(filters.status);
        }
        if (filters.accountingMonth) {
          sql += " AND accounting_month = ?";
          params.push(filters.accountingMonth);
        }
        if (filters.fromDate) {
          sql += " AND expense_date >= ?";
          params.push(filters.fromDate);
        }
        if (filters.toDate) {
          sql += " AND expense_date <= ?";
          params.push(filters.toDate);
        }
        if (filters.projectId) {
          sql += " AND project_id = ?";
          params.push(filters.projectId);
        }
        if (filters.workerId) {
          sql += " AND worker_id = ?";
          params.push(filters.workerId);
        }
      }

      sql += " ORDER BY expense_date DESC, id DESC";
      return { success: true, data: db.all(sql, params) };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.EXPENSES.GET,
    safe((event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const expense = db.get("SELECT * FROM expenses WHERE id = ?", [id]);
      if (!expense)
        return { success: false, error: { code: "NOT_FOUND", message: "Expense not found" } };
      return { success: true, data: expense };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.EXPENSES.CREATE,
    safe((event, token, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      if (!data || !data.amount || parseFloat(data.amount) <= 0)
        return {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Amount must be positive" },
        };
      if (data.project_id) {
        const project = db.get("SELECT id FROM projects WHERE id = ?", [data.project_id]);
        if (!project)
          return { success: false, error: { code: "VALIDATION_ERROR", message: "Project not found" } };
        if (data.scope === CASH_SCOPE.PERSONAL)
          return {
            success: false,
            error: { code: "VALIDATION_ERROR", message: "A personal expense cannot be linked to a business project" },
          };
      }
      if (data.worker_id) {
        const worker = db.get("SELECT id FROM workers WHERE id = ?", [data.worker_id]);
        if (!worker)
          return { success: false, error: { code: "VALIDATION_ERROR", message: "Worker not found" } };
      }

      const input = resolveExpenseInput(data);

      const expenseId = db.transaction(() => {
        const result = db.run(
          `INSERT INTO expenses
             (amount, category, expense_date, accounting_month, method, description, scope, project_id, worker_id, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            input.amount,
            input.category,
            input.expenseDate,
            input.accountingMonth,
            input.method,
            input.description,
            input.scope,
            input.projectId,
            input.workerId,
            input.status,
          ],
        );
        const newExpenseId = result.lastInsertRowid;

        if (input.status === EXPENSE_STATUS.PAID) {
          postLedgerEntry(db, {
            direction: CASH_DIRECTION.OUT,
            scope: input.scope,
            amount: input.amount,
            txnDate: input.expenseDate,
            accountingMonth: input.accountingMonth,
            method: input.method,
            sourceType: CASH_SOURCE_TYPE.EXPENSE,
            sourceId: newExpenseId,
            description: ledgerDescription({ description: input.description, category: input.category }),
          });
        }

        return newExpenseId;
      })();

      return { success: true, data: db.get("SELECT * FROM expenses WHERE id = ?", [expenseId]) };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.EXPENSES.UPDATE,
    safe((event, token, id, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const existing = db.get("SELECT * FROM expenses WHERE id = ?", [id]);
      if (!existing)
        return { success: false, error: { code: "NOT_FOUND", message: "Expense not found" } };

      if (!data || !data.amount || parseFloat(data.amount) <= 0)
        return {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Amount must be positive" },
        };
      if (data.project_id) {
        const project = db.get("SELECT id FROM projects WHERE id = ?", [data.project_id]);
        if (!project)
          return { success: false, error: { code: "VALIDATION_ERROR", message: "Project not found" } };
        if (data.scope === CASH_SCOPE.PERSONAL)
          return {
            success: false,
            error: { code: "VALIDATION_ERROR", message: "A personal expense cannot be linked to a business project" },
          };
      }
      if (data.worker_id) {
        const worker = db.get("SELECT id FROM workers WHERE id = ?", [data.worker_id]);
        if (!worker)
          return { success: false, error: { code: "VALIDATION_ERROR", message: "Worker not found" } };
      }

      const input = resolveExpenseInput(data);

      db.transaction(() => {
        db.run(
          `UPDATE expenses SET
             amount = ?, category = ?, expense_date = ?, accounting_month = ?, method = ?,
             description = ?, scope = ?, project_id = ?, worker_id = ?, status = ?
           WHERE id = ?`,
          [
            input.amount,
            input.category,
            input.expenseDate,
            input.accountingMonth,
            input.method,
            input.description,
            input.scope,
            input.projectId,
            input.workerId,
            input.status,
            id,
          ],
        );

        const ledgerFields = {
          direction: CASH_DIRECTION.OUT,
          scope: input.scope,
          amount: input.amount,
          txnDate: input.expenseDate,
          accountingMonth: input.accountingMonth,
          method: input.method,
          sourceType: CASH_SOURCE_TYPE.EXPENSE,
          sourceId: id,
          description: ledgerDescription({ description: input.description, category: input.category }),
        };

        const wasPaid = existing.status === EXPENSE_STATUS.PAID;
        const isPaid = input.status === EXPENSE_STATUS.PAID;

        if (!wasPaid && isPaid) {
          postLedgerEntry(db, ledgerFields);
        } else if (wasPaid && !isPaid) {
          reverseLedgerEntry(db, { sourceType: CASH_SOURCE_TYPE.EXPENSE, sourceId: id });
        } else if (wasPaid && isPaid) {
          // Still paid — keep the existing ledger row's identity, just
          // bring its fields in line with the edit (amount/date/category/
          // scope/method may all have changed).
          updateLedgerEntry(db, ledgerFields);
        }
        // unpaid -> unpaid: no ledger row exists or is needed.
      })();

      return { success: true, data: db.get("SELECT * FROM expenses WHERE id = ?", [id]) };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.EXPENSES.DELETE,
    safe((event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const expense = db.get("SELECT * FROM expenses WHERE id = ?", [id]);
      if (!expense)
        return { success: false, error: { code: "NOT_FOUND", message: "Expense not found" } };

      db.transaction(() => {
        if (expense.status === EXPENSE_STATUS.PAID) {
          reverseLedgerEntry(db, { sourceType: CASH_SOURCE_TYPE.EXPENSE, sourceId: id });
        }
        db.run("DELETE FROM expenses WHERE id = ?", [id]);
      })();

      return { success: true };
    }),
  );
}
