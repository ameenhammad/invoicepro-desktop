import { ipcMain } from "electron";
import { IPC_CHANNELS, INVOICE_STATUS } from "../../shared/constants.js";
import { requireAuth, safe } from "./helpers.js";
import { prorationCTE, PRORATED_REVENUE_EXPR } from "../proration.js";
import { computeProjectFinancials } from "../project-finance.js";

// All-time proration CTE (no period filter) — used by the report endpoints
// below that intentionally show lifetime totals. See proration.js for the
// period-scoped version used by dashboard/period-filtered reports.
const PRORATION_CTE = prorationCTE().sql;

export function registerReportHandlers(db) {
  ipcMain.handle(
    IPC_CHANNELS.REPORTS.SUMMARY,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const totalRevenue = db.get(
        "SELECT COALESCE(SUM(total), 0) as value FROM invoices WHERE status = ?",
        [INVOICE_STATUS.PAID],
      ).value;
      const pendingAmount = db.get(
        "SELECT COALESCE(SUM(total), 0) as value FROM invoices WHERE status IN (?, ?)",
        [INVOICE_STATUS.PENDING, INVOICE_STATUS.PARTIAL],
      ).value;
      const totalInvoices = db.get(
        "SELECT COUNT(*) as value FROM invoices",
      ).value;
      const paidInvoices = db.get(
        "SELECT COUNT(*) as value FROM invoices WHERE status = ?",
        [INVOICE_STATUS.PAID],
      ).value;
      const pendingInvoices = db.get(
        "SELECT COUNT(*) as value FROM invoices WHERE status IN (?, ?)",
        [INVOICE_STATUS.PENDING, INVOICE_STATUS.PARTIAL],
      ).value;
      const totalClients = db.get(
        "SELECT COUNT(*) as value FROM clients WHERE is_active = 1",
      ).value;
      const totalProducts = db.get(
        "SELECT COUNT(*) as value FROM products WHERE is_active = 1",
      ).value;
      const lowStockAlerts = db.get(
        "SELECT COUNT(*) as value FROM product_variants WHERE is_active = 1 AND quantity <= low_stock_threshold",
      ).value;

      const today = new Date().toISOString().split("T")[0];
      const todaysSales = db.get(
        "SELECT COALESCE(SUM(total), 0) as value FROM invoices WHERE status = ? AND issue_date = ?",
        [INVOICE_STATUS.PAID, today],
      ).value;
      const todaysOrders = db.get(
        "SELECT COUNT(*) as value FROM invoices WHERE issue_date = ?",
        [today],
      ).value;

      return {
        success: true,
        data: {
          totalRevenue,
          pendingAmount,
          totalInvoices,
          paidInvoices,
          pendingInvoices,
          totalClients,
          totalProducts,
          lowStockAlerts,
          todaysSales,
          todaysOrders,
        },
      };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.REVENUE,
    safe((event, token, filters) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      let sql = `SELECT i.*, c.name as client_name FROM invoices i JOIN clients c ON i.client_id = c.id WHERE i.status = ?`;
      const params = [INVOICE_STATUS.PAID];

      if (filters) {
        if (filters.fromDate) {
          sql += " AND i.issue_date >= ?";
          params.push(filters.fromDate);
        }
        if (filters.toDate) {
          sql += " AND i.issue_date <= ?";
          params.push(filters.toDate);
        }
        if (filters.clientId) {
          sql += " AND i.client_id = ?";
          params.push(filters.clientId);
        }
      }

      sql += " ORDER BY i.issue_date DESC";
      const invoices = db.all(sql, params);
      const total = invoices.reduce((sum, inv) => sum + inv.total, 0);

      // Same filters, but broken down by line-item type for the
      // Product / Service revenue split.
      let itemSql = `SELECT
              COALESCE(SUM(CASE WHEN ii.product_id IS NOT NULL THEN ii.line_total ELSE 0 END), 0) as product_revenue,
              COALESCE(SUM(CASE WHEN ii.service_id IS NOT NULL THEN ii.line_total ELSE 0 END), 0) as service_revenue,
              COALESCE(SUM(CASE WHEN ii.product_id IS NULL AND ii.service_id IS NULL THEN ii.line_total ELSE 0 END), 0) as other_revenue
            FROM invoice_items ii
            JOIN invoices i ON ii.invoice_id = i.id
            WHERE i.status = ?`;
      const itemParams = [INVOICE_STATUS.PAID];
      if (filters) {
        if (filters.fromDate) {
          itemSql += " AND i.issue_date >= ?";
          itemParams.push(filters.fromDate);
        }
        if (filters.toDate) {
          itemSql += " AND i.issue_date <= ?";
          itemParams.push(filters.toDate);
        }
        if (filters.clientId) {
          itemSql += " AND i.client_id = ?";
          itemParams.push(filters.clientId);
        }
      }
      const breakdown = db.get(itemSql, itemParams);

      return {
        success: true,
        data: {
          invoices,
          total,
          productRevenue: breakdown.product_revenue,
          serviceRevenue: breakdown.service_revenue,
          otherRevenue: breakdown.other_revenue,
        },
      };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.PENDING,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const invoices = db.all(
        `SELECT i.*, c.name as client_name, (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = i.id) as paid_amount
       FROM invoices i JOIN clients c ON i.client_id = c.id
       WHERE i.status IN (?, ?) ORDER BY i.due_date ASC`,
        [INVOICE_STATUS.PENDING, INVOICE_STATUS.PARTIAL],
      );

      return { success: true, data: invoices };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.SALES_ANALYTICS,
    safe((event, token, period) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      let groupBy;
      switch (period) {
        case "daily":
          groupBy = "DATE(i.issue_date)";
          break;
        case "yearly":
          groupBy = "strftime('%Y', i.issue_date)";
          break;
        default:
          groupBy = "strftime('%Y-%m', i.issue_date)";
      }

      const data = db.all(
        `SELECT ${groupBy} as period,
              COUNT(*) as invoice_count,
              COALESCE(SUM(i.total), 0) as total_revenue
       FROM invoices i
       WHERE i.status = ? AND i.issue_date IS NOT NULL
       GROUP BY ${groupBy}
       ORDER BY period DESC
       LIMIT 24`,
        [INVOICE_STATUS.PAID],
      );

      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.TOP_PRODUCTS,
    safe((event, token, limit = 10) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const data = db.all(
        `SELECT p.name as product_name,
              pv.size_name as variant_name,
              SUM(ii.quantity) as total_sold,
              SUM(ii.line_total) as total_revenue
       FROM invoice_items ii
       JOIN products p ON ii.product_id = p.id
       JOIN product_variants pv ON ii.variant_id = pv.id
       JOIN invoices i ON ii.invoice_id = i.id
       WHERE i.status = ?
       GROUP BY ii.variant_id
       ORDER BY total_sold DESC
       LIMIT ?`,
        [INVOICE_STATUS.PAID, limit],
      );

      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.TOP_SERVICES,
    safe((event, token, limit = 10) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const data = db.all(
        `SELECT s.name as service_name,
              SUM(ii.quantity) as total_sold,
              SUM(ii.line_total) as total_revenue
       FROM invoice_items ii
       JOIN services s ON ii.service_id = s.id
       JOIN invoices i ON ii.invoice_id = i.id
       WHERE i.status = ?
       GROUP BY ii.service_id
       ORDER BY total_sold DESC
       LIMIT ?`,
        [INVOICE_STATUS.PAID, limit],
      );

      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.STOCK_LEVELS,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const data = db.all(
        `SELECT p.id as product_id, p.name as product_name,
              pv.id as variant_id, pv.size_name as variant_name,
              pv.sku, pv.price, pv.quantity as stock, pv.low_stock_threshold
       FROM product_variants pv
       JOIN products p ON pv.product_id = p.id
       WHERE pv.is_active = 1 AND p.is_active = 1
       ORDER BY p.name, pv.size_name`,
      );

      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.LOW_STOCK,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const data = db.all(
        `SELECT p.id as product_id, p.name as product_name,
              pv.id as variant_id, pv.size_name as variant_name,
              pv.sku, pv.quantity as stock, pv.low_stock_threshold
       FROM product_variants pv
       JOIN products p ON pv.product_id = p.id
       WHERE pv.is_active = 1 AND p.is_active = 1 AND pv.quantity <= pv.low_stock_threshold
       ORDER BY pv.quantity ASC`,
      );

      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.SERVICE_REVENUE,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const value = db.get(
        `${PRORATION_CTE}
         SELECT COALESCE(SUM(ii.line_total * COALESCE(ir.received, 0) / NULLIF(it.items_total, 0)), 0) as v
         FROM invoice_items ii
         JOIN invoice_item_totals it ON it.invoice_id = ii.invoice_id
         LEFT JOIN invoice_received ir ON ir.invoice_id = ii.invoice_id
         WHERE ii.service_id IS NOT NULL`,
      ).v;

      return { success: true, data: { value } };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.HARDWARE_REVENUE,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const value = db.get(
        `${PRORATION_CTE}
         SELECT COALESCE(SUM(ii.line_total * COALESCE(ir.received, 0) / NULLIF(it.items_total, 0)), 0) as v
         FROM invoice_items ii
         JOIN invoice_item_totals it ON it.invoice_id = ii.invoice_id
         LEFT JOIN invoice_received ir ON ir.invoice_id = ii.invoice_id
         WHERE ii.product_id IS NOT NULL`,
      ).v;

      return { success: true, data: { value } };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.SERVICE_SALES_BY_TYPE,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const data = db.all(
        `${PRORATION_CTE}
         SELECT s.id as service_id, s.name as service_name, s.unit,
                COALESCE(SUM(ii.quantity), 0) as quantity_sold,
                COALESCE(SUM(ii.line_total * COALESCE(ir.received, 0) / NULLIF(it.items_total, 0)), 0) as revenue
         FROM services s
         LEFT JOIN invoice_items ii ON ii.service_id = s.id
         LEFT JOIN invoice_item_totals it ON it.invoice_id = ii.invoice_id
         LEFT JOIN invoice_received ir ON ir.invoice_id = ii.invoice_id
         GROUP BY s.id
         ORDER BY revenue DESC`,
      );

      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.HARDWARE_SALES_BY_PRODUCT,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const data = db.all(
        `${PRORATION_CTE}
         SELECT p.id as product_id, p.name as product_name, pv.id as variant_id, pv.size_name as variant_name,
                COALESCE(SUM(ii.quantity), 0) as quantity_sold,
                COALESCE(SUM(ii.line_total * COALESCE(ir.received, 0) / NULLIF(it.items_total, 0)), 0) as revenue
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
         LEFT JOIN invoice_items ii ON ii.variant_id = pv.id
         LEFT JOIN invoice_item_totals it ON it.invoice_id = ii.invoice_id
         LEFT JOIN invoice_received ir ON ir.invoice_id = ii.invoice_id
         GROUP BY pv.id
         ORDER BY revenue DESC`,
      );

      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.STOCK_MOVEMENTS,
    safe((event, token, filters) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      let sql = `SELECT sm.*, pv.size_name as variant_name, p.name as product_name
                 FROM stock_movements sm
                 JOIN product_variants pv ON pv.id = sm.variant_id
                 JOIN products p ON p.id = pv.product_id
                 WHERE 1=1`;
      const params = [];

      if (filters) {
        if (filters.variantId) {
          sql += " AND sm.variant_id = ?";
          params.push(filters.variantId);
        }
        if (filters.productId) {
          sql += " AND p.id = ?";
          params.push(filters.productId);
        }
        if (filters.reason) {
          sql += " AND sm.reason = ?";
          params.push(filters.reason);
        }
        if (filters.fromDate) {
          sql += " AND date(sm.created_at) >= ?";
          params.push(filters.fromDate);
        }
        if (filters.toDate) {
          sql += " AND date(sm.created_at) <= ?";
          params.push(filters.toDate);
        }
      }

      sql += " ORDER BY sm.created_at DESC, sm.id DESC LIMIT ?";
      params.push(filters?.limit || 100);

      return { success: true, data: db.all(sql, params) };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.INVENTORY_VALUE,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const value = db.get(
        `SELECT COALESCE(SUM(quantity * cost_price), 0) as cost_value,
                COALESCE(SUM(quantity * price), 0) as retail_value
         FROM product_variants WHERE is_active = 1`,
      );

      return { success: true, data: value };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.WORKSHOP_SUMMARY,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const revenueForService = (name) => {
        const service = db.get("SELECT id FROM services WHERE name = ?", [name]);
        if (!service) return 0;
        return db.get(
          `${PRORATION_CTE}
           SELECT COALESCE(SUM(ii.line_total * COALESCE(ir.received, 0) / NULLIF(it.items_total, 0)), 0) as v
           FROM invoice_items ii
           JOIN invoice_item_totals it ON it.invoice_id = ii.invoice_id
           LEFT JOIN invoice_received ir ON ir.invoice_id = ii.invoice_id
           WHERE ii.service_id = ?`,
          [service.id],
        ).v;
      };

      const sheetCuttingRevenue = revenueForService("Sheet Cutting");
      const edgeBandingRevenue = revenueForService("Edge Banding");

      const hardwareSales = db.get(
        `${PRORATION_CTE}
         SELECT COALESCE(SUM(ii.line_total * COALESCE(ir.received, 0) / NULLIF(it.items_total, 0)), 0) as v
         FROM invoice_items ii
         JOIN invoice_item_totals it ON it.invoice_id = ii.invoice_id
         LEFT JOIN invoice_received ir ON ir.invoice_id = ii.invoice_id
         WHERE ii.product_id IS NOT NULL`,
      ).v;

      const lowStockItems = db.get(
        "SELECT COUNT(*) as c FROM product_variants WHERE is_active = 1 AND quantity <= low_stock_threshold",
      ).c;

      const recentServiceSales = db.all(
        `SELECT ii.id, ii.description, ii.quantity, ii.unit_price, ii.line_total,
                s.name as service_name, s.unit,
                i.invoice_number, i.issue_date, i.status
         FROM invoice_items ii
         JOIN services s ON s.id = ii.service_id
         JOIN invoices i ON i.id = ii.invoice_id
         ORDER BY i.created_at DESC, ii.id DESC
         LIMIT 8`,
      );

      const recentHardwareSales = db.all(
        `SELECT ii.id, ii.description, ii.quantity, ii.unit_price, ii.line_total,
                p.name as product_name, pv.size_name as variant_name,
                i.invoice_number, i.issue_date, i.status
         FROM invoice_items ii
         JOIN product_variants pv ON pv.id = ii.variant_id
         JOIN products p ON p.id = pv.product_id
         JOIN invoices i ON i.id = ii.invoice_id
         ORDER BY i.created_at DESC, ii.id DESC
         LIMIT 8`,
      );

      return {
        success: true,
        data: {
          sheetCuttingRevenue,
          edgeBandingRevenue,
          hardwareSales,
          lowStockItems,
          recentServiceSales,
          recentHardwareSales,
        },
      };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.PURCHASES_SUMMARY,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const totalPurchases = db.get("SELECT COALESCE(SUM(total), 0) as v FROM purchases").v;
      const outstandingSupplierPayments = db.get(
        `SELECT COALESCE(SUM(pu.total - (SELECT COALESCE(SUM(amount), 0) FROM purchase_payments WHERE purchase_id = pu.id)), 0) as v
         FROM purchases pu WHERE pu.status IN ('unpaid', 'partial')`,
      ).v;
      const purchaseCostPaid = db.get(
        `SELECT COALESCE(SUM(ct.amount), 0) as v
         FROM cash_transactions ct
         JOIN purchase_payments pp ON ct.source_type = 'purchase_payment' AND ct.source_id = pp.id
         WHERE ct.direction = 'out'`,
      ).v;

      return { success: true, data: { totalPurchases, outstandingSupplierPayments, purchaseCostPaid } };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.PURCHASES_BY_SUPPLIER,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const data = db.all(
        `SELECT s.id as supplier_id, s.name as supplier_name,
                COALESCE(SUM(pu.total), 0) as total_purchases,
                COALESCE(SUM((SELECT COALESCE(SUM(amount), 0) FROM purchase_payments WHERE purchase_id = pu.id)), 0) as total_paid,
                COALESCE(SUM(pu.total - (SELECT COALESCE(SUM(amount), 0) FROM purchase_payments WHERE purchase_id = pu.id)), 0) as outstanding
         FROM suppliers s
         LEFT JOIN purchases pu ON pu.supplier_id = s.id
         GROUP BY s.id
         ORDER BY total_purchases DESC`,
      );

      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.PURCHASES_BY_MONTH,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const data = db.all(
        `SELECT accounting_month, COALESCE(SUM(total), 0) as total
         FROM purchases GROUP BY accounting_month ORDER BY accounting_month DESC LIMIT 24`,
      );

      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.WAGES_SUMMARY,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const totalWages = db.get(
        "SELECT COALESCE(SUM(amount), 0) as v FROM expenses WHERE worker_id IS NOT NULL",
      ).v;
      const wagesPaid = db.get(
        `SELECT COALESCE(SUM(ct.amount), 0) as v
         FROM cash_transactions ct
         JOIN expenses e ON ct.source_type = 'expense' AND ct.source_id = e.id
         WHERE e.worker_id IS NOT NULL AND ct.direction = 'out'`,
      ).v;

      return { success: true, data: { totalWages, wagesPaid } };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.WAGES_BY_WORKER,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const data = db.all(
        `SELECT w.id as worker_id, w.name as worker_name, w.role,
                COALESCE(SUM(e.amount), 0) as total_wages,
                COALESCE(SUM(CASE WHEN e.status = 'paid' THEN e.amount ELSE 0 END), 0) as paid
         FROM workers w
         LEFT JOIN expenses e ON e.worker_id = w.id
         GROUP BY w.id
         ORDER BY total_wages DESC`,
      );

      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.WAGES_BY_MONTH,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const data = db.all(
        `SELECT accounting_month, COALESCE(SUM(amount), 0) as total
         FROM expenses WHERE worker_id IS NOT NULL
         GROUP BY accounting_month ORDER BY accounting_month DESC LIMIT 24`,
      );

      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.PROJECT_LABOUR_COST,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const data = db.all(
        `SELECT pr.id as project_id, pr.project_number, pr.name as project_name,
                COALESCE(SUM(e.amount), 0) as labour_cost
         FROM projects pr
         JOIN expenses e ON e.project_id = pr.id AND e.worker_id IS NOT NULL
         GROUP BY pr.id
         ORDER BY labour_cost DESC`,
      );

      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.STOCK_RECEIVED,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const data = db.all(
        `SELECT p.id as product_id, p.name as product_name, pv.id as variant_id, pv.size_name as variant_name,
                COALESCE(SUM(pi.quantity), 0) as quantity_received,
                COALESCE(SUM(pi.line_total), 0) as value_received
         FROM purchase_items pi
         JOIN product_variants pv ON pv.id = pi.variant_id
         JOIN products p ON p.id = pv.product_id
         GROUP BY pv.id
         ORDER BY value_received DESC`,
      );

      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.INCOME_BREAKDOWN,
    safe((event, token, filters = {}) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      // Mutually exclusive buckets so every prorated dollar lands in
      // exactly one row and the rows sum to total income for the period —
      // a project-linked invoice counts as Project Income even if it also
      // contains hardware, since that's the more useful lens for a
      // project-run workshop. Reuses the same proration formula as the
      // Workshop reports, just with a different GROUP BY.
      const cte = prorationCTE({
        accountingMonth: filters.accountingMonth,
        fromDate: filters.fromDate,
        toDate: filters.toDate,
      });

      const data = db.all(
        `${cte.sql}
         SELECT
           CASE
             WHEN i.project_id IS NOT NULL THEN 'Project Income'
             WHEN s.name = 'Sheet Cutting' THEN 'Sheet Cutting'
             WHEN s.name = 'Edge Banding' THEN 'Edge Banding'
             WHEN ii.product_id IS NOT NULL THEN 'Hardware Sales'
             ELSE 'Other Income'
           END as category,
           COALESCE(SUM(${PRORATED_REVENUE_EXPR}), 0) as amount
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id
         LEFT JOIN services s ON s.id = ii.service_id
         JOIN invoice_item_totals it ON it.invoice_id = ii.invoice_id
         LEFT JOIN invoice_received ir ON ir.invoice_id = ii.invoice_id
         GROUP BY category
         ORDER BY amount DESC`,
        cte.params,
      );

      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.SERVICE_SALES_BY_MONTH,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      // Prorated at the individual-payment level (not per-invoice like the
      // other proration queries) because a period breakdown needs to know
      // WHICH month each dollar actually arrived in — an invoice paid
      // across two months must split across both. Summed over all months
      // this still equals the same all-time service revenue figure.
      const data = db.all(
        `SELECT ct.accounting_month as period,
                COALESCE(SUM(ct.amount * ii.line_total / it.items_total), 0) as revenue
         FROM cash_transactions ct
         JOIN payments p ON ct.source_type = 'invoice_payment' AND ct.source_id = p.id
         JOIN invoice_items ii ON ii.invoice_id = p.invoice_id AND ii.service_id IS NOT NULL
         JOIN (SELECT invoice_id, SUM(line_total) as items_total FROM invoice_items GROUP BY invoice_id) it
           ON it.invoice_id = p.invoice_id
         WHERE ct.direction = 'in' AND ct.scope = 'business'
         GROUP BY ct.accounting_month
         ORDER BY ct.accounting_month DESC
         LIMIT 24`,
      );

      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.REPORTS.DATA_INTEGRITY_CHECK,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const checks = [];

      // 1. No duplicate settlement entries per source document.
      const dupLedger = db.all(
        `SELECT source_type, source_id, COUNT(*) as c FROM cash_transactions
         GROUP BY source_type, source_id HAVING c > 1`,
      );
      checks.push({
        key: "ledger_duplicates",
        label: "No duplicate ledger settlement entries",
        status: dupLedger.length === 0 ? "pass" : "fail",
        details: dupLedger,
      });

      // 2. Stock movements reconcile with current stock.
      const stockRows = db.all(
        `SELECT pv.id as variant_id, p.name as product_name, pv.size_name as variant_name, pv.quantity as current_qty,
                COALESCE((SELECT SUM(change_qty) FROM stock_movements WHERE variant_id = pv.id), 0) as movement_sum
         FROM product_variants pv JOIN products p ON p.id = pv.product_id`,
      );
      const stockMismatches = stockRows.filter((r) => r.current_qty !== r.movement_sum);
      checks.push({
        key: "stock_reconciliation",
        label: "Stock movements reconcile with current stock",
        status: stockMismatches.length === 0 ? "pass" : "fail",
        details: stockMismatches,
      });

      // 3. Invoice status matches what its payments actually add up to.
      const invoiceRows = db.all(
        `SELECT i.id, i.invoice_number, i.status, i.total,
                COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id), 0) as paid
         FROM invoices i WHERE i.status NOT IN ('draft', 'cancelled')`,
      );
      const invoiceMismatches = invoiceRows.filter((i) => {
        const expected = i.paid <= 0 ? "pending" : i.paid >= i.total ? "paid" : "partial";
        return expected !== i.status;
      });
      checks.push({
        key: "invoice_totals",
        label: "Invoice status matches payment totals",
        status: invoiceMismatches.length === 0 ? "pass" : "fail",
        details: invoiceMismatches,
      });

      // 4. Purchase status matches what its payments actually add up to.
      const purchaseRows = db.all(
        `SELECT pu.id, pu.purchase_number, pu.status, pu.total,
                COALESCE((SELECT SUM(amount) FROM purchase_payments WHERE purchase_id = pu.id), 0) as paid
         FROM purchases pu`,
      );
      const purchaseMismatches = purchaseRows.filter((p) => {
        const expected = p.paid <= 0 ? "unpaid" : p.paid >= p.total ? "paid" : "partial";
        return expected !== p.status;
      });
      checks.push({
        key: "purchase_totals",
        label: "Purchase status matches payment totals",
        status: purchaseMismatches.length === 0 ? "pass" : "fail",
        details: purchaseMismatches,
      });

      // 5. Every project's financials compute cleanly and profit is
      // internally consistent (revenue - cost = profit, by construction —
      // this catches a project whose linked data is broken enough that the
      // centralized calculation throws or drifts, not a second profit calc).
      const projectRows = db.all("SELECT id, project_number FROM projects");
      const projectIssues = [];
      for (const p of projectRows) {
        try {
          const f = computeProjectFinancials(db, p.id);
          if (Math.round(f.profit * 100) !== Math.round((f.revenue - f.totalCost) * 100)) {
            projectIssues.push({ project_id: p.id, project_number: p.project_number, reason: "profit does not equal revenue - totalCost" });
          }
        } catch (err) {
          projectIssues.push({ project_id: p.id, project_number: p.project_number, reason: err.message });
        }
      }
      checks.push({
        key: "project_financials",
        label: "Project financials compute correctly",
        status: projectIssues.length === 0 ? "pass" : "fail",
        details: projectIssues,
      });

      // 6. Business/personal boundary: a personal expense should never be
      // linked to a (business) project.
      const boundaryViolations = db.all(
        "SELECT id, description, amount, expense_date FROM expenses WHERE scope = 'personal' AND project_id IS NOT NULL",
      );
      checks.push({
        key: "business_personal_boundary",
        label: "Business and personal transactions stay separated",
        status: boundaryViolations.length === 0 ? "pass" : "fail",
        details: boundaryViolations,
      });

      const allPass = checks.every((c) => c.status === "pass");
      return { success: true, data: { allPass, checks } };
    }),
  );
}
