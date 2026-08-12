import { ipcMain } from "electron";
import { IPC_CHANNELS, PURCHASE_STATUS, CASH_DIRECTION, CASH_SCOPE, CASH_SOURCE_TYPE, STOCK_MOVEMENT_REASON } from "../../shared/constants.js";
import { requireAuth, safe } from "./helpers.js";
import { postLedgerEntry, toAccountingMonth } from "../ledger.js";
import { recordStockMovement } from "../stock.js";

const PURCHASE_DETAIL_SELECT = `SELECT pu.*, s.name as supplier_name,
       pr.project_number as project_number, pr.name as project_name,
       (SELECT COALESCE(SUM(amount), 0) FROM purchase_payments WHERE purchase_id = pu.id) as paid_amount
       FROM purchases pu
       JOIN suppliers s ON s.id = pu.supplier_id
       LEFT JOIN projects pr ON pr.id = pu.project_id
       WHERE pu.id = ?`;

function nextPurchaseNumber(db) {
  const year = new Date().getFullYear();
  let seq = db.get("SELECT last_number FROM purchase_sequence WHERE year = ?", [year]);
  if (!seq) {
    db.run("INSERT INTO purchase_sequence (year, last_number) VALUES (?, 0)", [year]);
    seq = { last_number: 0 };
  }
  const nextNum = seq.last_number + 1;
  db.run("UPDATE purchase_sequence SET last_number = ? WHERE year = ?", [nextNum, year]);
  return `PUR-${year}-${String(nextNum).padStart(4, "0")}`;
}

export function registerPurchaseHandlers(db) {
  ipcMain.handle(
    IPC_CHANNELS.PURCHASES.GET_ALL,
    safe((event, token, filters) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      let sql = `SELECT pu.*, s.name as supplier_name,
                 (SELECT COALESCE(SUM(amount), 0) FROM purchase_payments WHERE purchase_id = pu.id) as paid_amount
                 FROM purchases pu JOIN suppliers s ON s.id = pu.supplier_id WHERE 1=1`;
      const params = [];

      if (filters) {
        if (filters.supplierId) {
          sql += " AND pu.supplier_id = ?";
          params.push(filters.supplierId);
        }
        if (filters.status) {
          sql += " AND pu.status = ?";
          params.push(filters.status);
        }
        if (filters.projectId) {
          sql += " AND pu.project_id = ?";
          params.push(filters.projectId);
        }
        if (filters.fromDate) {
          sql += " AND pu.purchase_date >= ?";
          params.push(filters.fromDate);
        }
        if (filters.toDate) {
          sql += " AND pu.purchase_date <= ?";
          params.push(filters.toDate);
        }
      }

      sql += " ORDER BY pu.created_at DESC";
      return { success: true, data: db.all(sql, params) };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.PURCHASES.GET,
    safe((event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const purchase = db.get(PURCHASE_DETAIL_SELECT, [id]);
      if (!purchase)
        return { success: false, error: { code: "NOT_FOUND", message: "Purchase not found" } };

      const items = db.all(
        `SELECT pi.*, pv.size_name as variant_name, p.name as product_name
         FROM purchase_items pi
         JOIN product_variants pv ON pv.id = pi.variant_id
         JOIN products p ON p.id = pv.product_id
         WHERE pi.purchase_id = ?`,
        [id],
      );
      const payments = db.all(
        "SELECT * FROM purchase_payments WHERE purchase_id = ? ORDER BY payment_date DESC",
        [id],
      );

      return { success: true, data: { ...purchase, items, payments } };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.PURCHASES.NEXT_NUMBER,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const year = new Date().getFullYear();
      let seq = db.get("SELECT last_number FROM purchase_sequence WHERE year = ?", [year]);
      if (!seq) seq = { last_number: 0 };
      return { success: true, data: `PUR-${year}-${String(seq.last_number + 1).padStart(4, "0")}` };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.PURCHASES.CREATE,
    safe((event, token, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const { supplier_id, project_id, purchase_date, accounting_month, items, status, payment_method, notes } = data || {};

      if (!supplier_id)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Supplier is required" } };
      const supplier = db.get("SELECT id FROM suppliers WHERE id = ?", [supplier_id]);
      if (!supplier)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Supplier not found" } };

      if (project_id) {
        const project = db.get("SELECT id FROM projects WHERE id = ?", [project_id]);
        if (!project)
          return { success: false, error: { code: "VALIDATION_ERROR", message: "Project not found" } };
      }

      if (!items || items.length === 0)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "At least one item is required" } };

      for (const item of items) {
        if (!item.variant_id)
          return { success: false, error: { code: "VALIDATION_ERROR", message: "Every purchase item must reference an existing product variant" } };
        const variant = db.get("SELECT id FROM product_variants WHERE id = ?", [item.variant_id]);
        if (!variant)
          return { success: false, error: { code: "VALIDATION_ERROR", message: `Variant not found: ${item.variant_id}` } };
        if (!item.quantity || item.quantity <= 0)
          return { success: false, error: { code: "VALIDATION_ERROR", message: "Item quantity must be positive" } };
        if (item.unit_cost === undefined || item.unit_cost < 0)
          return { success: false, error: { code: "VALIDATION_ERROR", message: "Item unit cost cannot be negative" } };
      }

      const resolvedDate = purchase_date || new Date().toISOString().split("T")[0];
      const resolvedAccountingMonth =
        accounting_month && /^\d{4}-\d{2}$/.test(accounting_month) ? accounting_month : toAccountingMonth(resolvedDate);
      // Only 'paid' is meaningful as a creation-time shortcut (mirrors
      // invoices' auto-pay-at-creation) — 'partial' only makes sense once an
      // actual partial payment exists, so anything else starts 'unpaid'.
      const resolvedStatus = status === PURCHASE_STATUS.PAID ? PURCHASE_STATUS.PAID : PURCHASE_STATUS.UNPAID;

      const purchaseId = db.transaction(() => {
        const purchaseNumber = nextPurchaseNumber(db);
        const total = items.reduce((sum, i) => sum + i.quantity * i.unit_cost, 0);

        const result = db.run(
          `INSERT INTO purchases (purchase_number, supplier_id, project_id, purchase_date, accounting_month, status, subtotal, total, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [purchaseNumber, supplier_id, project_id || null, resolvedDate, resolvedAccountingMonth, resolvedStatus, total, total, notes || ""],
        );
        const newPurchaseId = result.lastInsertRowid;

        for (const item of items) {
          const lineTotal = item.quantity * item.unit_cost;
          const itemResult = db.run(
            `INSERT INTO purchase_items (purchase_id, variant_id, description, quantity, unit_cost, line_total)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [newPurchaseId, item.variant_id, item.description || "", item.quantity, item.unit_cost, lineTotal],
          );

          // Receiving stock ONLY ever happens through recordStockMovement —
          // never a direct UPDATE — so the movement log and the cached
          // quantity can't drift apart.
          recordStockMovement(db, {
            variantId: item.variant_id,
            changeQty: item.quantity,
            reason: STOCK_MOVEMENT_REASON.STOCK_IN,
            referenceType: "purchase_item",
            referenceId: itemResult.lastInsertRowid,
            notes: `Received via purchase ${purchaseNumber}`,
          });

          // Keep the variant's cost basis current — "last cost wins", not a
          // weighted average (kept simple, matches this phase's scope).
          db.run("UPDATE product_variants SET cost_price = ? WHERE id = ?", [item.unit_cost, item.variant_id]);
        }

        if (resolvedStatus === PURCHASE_STATUS.PAID && total > 0) {
          const method = payment_method || "cash";
          const payResult = db.run(
            "INSERT INTO purchase_payments (purchase_id, amount, payment_date, method, reference, notes) VALUES (?, ?, ?, ?, '', '')",
            [newPurchaseId, total, resolvedDate, method],
          );

          postLedgerEntry(db, {
            direction: CASH_DIRECTION.OUT,
            scope: CASH_SCOPE.BUSINESS,
            amount: total,
            txnDate: resolvedDate,
            accountingMonth: resolvedAccountingMonth,
            method,
            sourceType: CASH_SOURCE_TYPE.PURCHASE_PAYMENT,
            sourceId: payResult.lastInsertRowid,
            description: `Purchase ${purchaseNumber} from supplier`,
          });
        }

        return newPurchaseId;
      })();

      return { success: true, data: db.get("SELECT * FROM purchases WHERE id = ?", [purchaseId]) };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.PURCHASES.DASHBOARD_SUMMARY,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const totalPurchases = db.get("SELECT COALESCE(SUM(total), 0) as v FROM purchases").v;
      const outstandingSupplierPayments = db.get(
        `SELECT COALESCE(SUM(pu.total - (SELECT COALESCE(SUM(amount), 0) FROM purchase_payments WHERE purchase_id = pu.id)), 0) as v
         FROM purchases pu
         WHERE pu.status IN ('unpaid', 'partial')`,
      ).v;

      const recentPurchases = db.all(
        `SELECT pu.id, pu.purchase_number, pu.purchase_date, pu.total, pu.status, s.name as supplier_name
         FROM purchases pu JOIN suppliers s ON s.id = pu.supplier_id
         ORDER BY pu.created_at DESC LIMIT 8`,
      );

      return { success: true, data: { totalPurchases, outstandingSupplierPayments, recentPurchases } };
    }),
  );
}
