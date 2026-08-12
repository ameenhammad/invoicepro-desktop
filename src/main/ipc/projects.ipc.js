import { ipcMain } from "electron";
import { IPC_CHANNELS, PROJECT_TYPES, PROJECT_STATUS, INVOICE_STATUS } from "../../shared/constants.js";
import { requireAuth, safe } from "./helpers.js";
import { computeProjectFinancials } from "../project-finance.js";

function normalizeType(type) {
  return PROJECT_TYPES.includes(type) ? type : "Other";
}

function normalizeStatus(status) {
  return Object.values(PROJECT_STATUS).includes(status) ? status : PROJECT_STATUS.QUOTATION;
}

function nextProjectNumber(db) {
  const year = new Date().getFullYear();
  let seq = db.get("SELECT last_number FROM project_sequence WHERE year = ?", [year]);
  if (!seq) {
    db.run("INSERT INTO project_sequence (year, last_number) VALUES (?, 0)", [year]);
    seq = { last_number: 0 };
  }
  const nextNum = seq.last_number + 1;
  db.run("UPDATE project_sequence SET last_number = ? WHERE year = ?", [nextNum, year]);
  return `PRJ-${year}-${String(nextNum).padStart(4, "0")}`;
}

export function registerProjectHandlers(db) {
  ipcMain.handle(
    IPC_CHANNELS.PROJECTS.GET_ALL,
    safe((event, token, filters) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      let sql = `SELECT pr.*, c.name as customer_name FROM projects pr JOIN clients c ON c.id = pr.customer_id WHERE 1=1`;
      const params = [];
      if (filters) {
        if (filters.status) {
          sql += " AND pr.status = ?";
          params.push(filters.status);
        }
        if (filters.customerId) {
          sql += " AND pr.customer_id = ?";
          params.push(filters.customerId);
        }
        if (filters.projectType) {
          sql += " AND pr.project_type = ?";
          params.push(filters.projectType);
        }
        if (filters.fromDate) {
          sql += " AND pr.start_date >= ?";
          params.push(filters.fromDate);
        }
        if (filters.toDate) {
          sql += " AND pr.start_date <= ?";
          params.push(filters.toDate);
        }
      }
      sql += " ORDER BY pr.created_at DESC";

      const projects = db.all(sql, params);
      // Reuse the same calculation the detail view uses, per-project — a
      // workshop's project count is small enough that this is simpler and
      // safer than a second, parallel SQL implementation that could drift
      // from the detail view's numbers.
      const data = projects.map((p) => {
        const financials = computeProjectFinancials(db, p.id);
        return {
          ...p,
          invoiced: financials.invoiced,
          amount_received: financials.amountReceived,
          outstanding: financials.outstanding,
          total_cost: financials.totalCost,
          profit: financials.profit,
          profit_margin: financials.profitMargin,
        };
      });

      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECTS.GET,
    safe((event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const financials = computeProjectFinancials(db, id);
      if (!financials)
        return { success: false, error: { code: "NOT_FOUND", message: "Project not found" } };

      const customer = db.get("SELECT * FROM clients WHERE id = ?", [financials.project.customer_id]);
      const invoices = db.all(
        `SELECT i.*, (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = i.id) as paid_amount
         FROM invoices i WHERE i.project_id = ? ORDER BY i.created_at DESC`,
        [id],
      );
      const payments = db.all(
        `SELECT pay.*, i.invoice_number
         FROM payments pay JOIN invoices i ON i.id = pay.invoice_id
         WHERE i.project_id = ? ORDER BY pay.payment_date DESC`,
        [id],
      );
      const expenses = db.all(
        `SELECT e.*, w.name as worker_name FROM expenses e LEFT JOIN workers w ON w.id = e.worker_id
         WHERE e.project_id = ? ORDER BY e.expense_date DESC`,
        [id],
      );
      const purchases = db.all(
        `SELECT pu.*, s.name as supplier_name,
                (SELECT COALESCE(SUM(amount), 0) FROM purchase_payments WHERE purchase_id = pu.id) as paid_amount
         FROM purchases pu JOIN suppliers s ON s.id = pu.supplier_id
         WHERE pu.project_id = ? ORDER BY pu.created_at DESC`,
        [id],
      );

      return {
        success: true,
        data: { ...financials, customer, invoices, payments, expenses, purchases },
      };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECTS.CREATE,
    safe((event, token, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const { customer_id, name, project_type, description, start_date, expected_completion_date, status, quoted_amount, notes } =
        data || {};

      if (!customer_id)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Customer is required" } };
      if (!name)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Project name is required" } };

      const customer = db.get("SELECT id FROM clients WHERE id = ?", [customer_id]);
      if (!customer)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Customer not found" } };

      const quotedAmount = parseFloat(quoted_amount) || 0;
      if (quotedAmount < 0)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Quoted amount cannot be negative" } };

      const projectId = db.transaction(() => {
        const projectNumber = nextProjectNumber(db);
        const result = db.run(
          `INSERT INTO projects
             (project_number, customer_id, name, project_type, description, start_date, expected_completion_date, status, quoted_amount, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            projectNumber,
            customer_id,
            name,
            normalizeType(project_type),
            description || "",
            start_date || null,
            expected_completion_date || null,
            normalizeStatus(status),
            quotedAmount,
            notes || "",
          ],
        );
        return result.lastInsertRowid;
      })();

      return { success: true, data: db.get("SELECT * FROM projects WHERE id = ?", [projectId]) };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECTS.UPDATE,
    safe((event, token, id, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const existing = db.get("SELECT * FROM projects WHERE id = ?", [id]);
      if (!existing)
        return { success: false, error: { code: "NOT_FOUND", message: "Project not found" } };

      const { customer_id, name, project_type, description, start_date, expected_completion_date, status, quoted_amount, notes } =
        data || {};

      if (!customer_id)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Customer is required" } };
      if (!name)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Project name is required" } };

      const customer = db.get("SELECT id FROM clients WHERE id = ?", [customer_id]);
      if (!customer)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Customer not found" } };

      const quotedAmount = parseFloat(quoted_amount) || 0;
      if (quotedAmount < 0)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Quoted amount cannot be negative" } };

      db.run(
        `UPDATE projects SET
           customer_id = ?, name = ?, project_type = ?, description = ?, start_date = ?,
           expected_completion_date = ?, status = ?, quoted_amount = ?, notes = ?
         WHERE id = ?`,
        [
          customer_id,
          name,
          normalizeType(project_type),
          description || "",
          start_date || null,
          expected_completion_date || null,
          normalizeStatus(status),
          quotedAmount,
          notes || "",
          id,
        ],
      );

      return { success: true, data: db.get("SELECT * FROM projects WHERE id = ?", [id]) };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECTS.DELETE,
    safe((event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const existing = db.get("SELECT id FROM projects WHERE id = ?", [id]);
      if (!existing)
        return { success: false, error: { code: "NOT_FOUND", message: "Project not found" } };

      const linkedInvoices = db.get("SELECT COUNT(*) as c FROM invoices WHERE project_id = ?", [id]).c;
      const linkedExpenses = db.get("SELECT COUNT(*) as c FROM expenses WHERE project_id = ?", [id]).c;
      const linkedPurchases = db.get("SELECT COUNT(*) as c FROM purchases WHERE project_id = ?", [id]).c;
      if (linkedInvoices > 0 || linkedExpenses > 0 || linkedPurchases > 0)
        return {
          success: false,
          error: {
            code: "HAS_LINKED_RECORDS",
            message: "Cannot delete a project with linked invoices, expenses, or purchases — unlink them first",
          },
        };

      db.run("DELETE FROM projects WHERE id = ?", [id]);
      return { success: true };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECTS.DASHBOARD_SUMMARY,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const activeCount = db.get(
        "SELECT COUNT(*) as c FROM projects WHERE status IN (?, ?)",
        [PROJECT_STATUS.CONFIRMED, PROJECT_STATUS.IN_PROGRESS],
      ).c;

      const nearingCompletion = db.all(
        `SELECT id, project_number, name, expected_completion_date
         FROM projects
         WHERE status = ? AND expected_completion_date IS NOT NULL AND expected_completion_date <= date('now', '+7 days')
         ORDER BY expected_completion_date ASC
         LIMIT 5`,
        [PROJECT_STATUS.IN_PROGRESS],
      );

      const outstandingPayments = db.get(
        `SELECT COALESCE(SUM(i.total - COALESCE(pd.paid, 0)), 0) as v
         FROM invoices i
         JOIN projects pr ON pr.id = i.project_id
         LEFT JOIN (SELECT invoice_id, SUM(amount) as paid FROM payments GROUP BY invoice_id) pd ON pd.invoice_id = i.id
         WHERE i.status IN (?, ?) AND pr.status != ?`,
        [INVOICE_STATUS.PENDING, INVOICE_STATUS.PARTIAL, PROJECT_STATUS.CANCELLED],
      ).v;

      const revenue = db.get(
        `SELECT COALESCE(SUM(ct.amount), 0) as v
         FROM cash_transactions ct
         JOIN payments p ON ct.source_type = 'invoice_payment' AND ct.source_id = p.id
         JOIN invoices i ON i.id = p.invoice_id
         JOIN projects pr ON pr.id = i.project_id
         WHERE ct.direction = 'in' AND pr.status != ?`,
        [PROJECT_STATUS.CANCELLED],
      ).v;

      const cost = db.get(
        `SELECT COALESCE(SUM(e.amount), 0) as v
         FROM expenses e
         JOIN projects pr ON pr.id = e.project_id
         WHERE pr.status != ?`,
        [PROJECT_STATUS.CANCELLED],
      ).v;

      return {
        success: true,
        data: { activeCount, nearingCompletion, outstandingPayments, revenue, cost, profit: revenue - cost },
      };
    }),
  );
}
