import { ipcMain } from "electron";
import { IPC_CHANNELS, CASH_DIRECTION, CASH_SCOPE, INVOICE_STATUS } from "../../shared/constants.js";
import { requireAuth, safe } from "./helpers.js";
import { prorationCTE, PRORATED_REVENUE_EXPR } from "../proration.js";

// Every figure here reads cash_transactions (the ledger) — never invoices
// or expenses directly — so cash-flow numbers can't drift from what the
// ledger says actually moved. The one exception is "outstanding
// receivables", which is deliberately accrual-based (invoices - payments):
// an unpaid invoice is real money owed, but it is not cash, so it has no
// business being computed from the ledger.

// Builds a WHERE clause + params over cash_transactions (optionally
// aliased, for queries that JOIN it against another table). accountingMonth
// takes precedence over a from/to date range when both are given.
function buildLedgerWhere({ scope, direction, fromDate, toDate, accountingMonth, alias = "" }) {
  const p = alias ? `${alias}.` : "";
  const clauses = [];
  const params = [];

  if (scope) {
    clauses.push(`${p}scope = ?`);
    params.push(scope);
  }
  if (direction) {
    clauses.push(`${p}direction = ?`);
    params.push(direction);
  }
  if (accountingMonth) {
    clauses.push(`${p}accounting_month = ?`);
    params.push(accountingMonth);
  } else {
    if (fromDate) {
      clauses.push(`${p}txn_date >= ?`);
      params.push(fromDate);
    }
    if (toDate) {
      clauses.push(`${p}txn_date <= ?`);
      params.push(toDate);
    }
  }

  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function sumLedger(db, filters) {
  const { where, params } = buildLedgerWhere(filters);
  return db.get(`SELECT COALESCE(SUM(amount), 0) as v FROM cash_transactions ${where}`, params).v;
}

function outstandingReceivables(db) {
  return (
    db.get(
      `SELECT COALESCE(SUM(i.total - COALESCE(pd.paid, 0)), 0) as v
       FROM invoices i
       LEFT JOIN (SELECT invoice_id, SUM(amount) as paid FROM payments GROUP BY invoice_id) pd
         ON pd.invoice_id = i.id
       WHERE i.status IN (?, ?)`,
      [INVOICE_STATUS.PENDING, INVOICE_STATUS.PARTIAL],
    ).v || 0
  );
}

// Current supplier debt — like outstandingReceivables, this is a
// point-in-time balance, not something bounded by a reporting period.
function outstandingPayables(db) {
  return db.get(
    `SELECT COALESCE(SUM(pu.total - (SELECT COALESCE(SUM(amount), 0) FROM purchase_payments WHERE purchase_id = pu.id)), 0) as v
     FROM purchases pu WHERE pu.status IN ('unpaid', 'partial')`,
  ).v;
}

// A period-scoped, prorated revenue figure for one line-item category
// (services, hardware, or project-linked invoices) — reuses the exact
// same cash-basis proration formula the Workshop reports use, just
// re-parameterized to a given accounting month instead of all-time.
function categoryRevenueForMonth(db, accountingMonth, whereClause) {
  const cte = prorationCTE({ accountingMonth });
  return db.get(
    `${cte.sql}
     SELECT COALESCE(SUM(${PRORATED_REVENUE_EXPR}), 0) as v
     FROM invoice_items ii
     JOIN invoices i ON i.id = ii.invoice_id
     JOIN invoice_item_totals it ON it.invoice_id = ii.invoice_id
     LEFT JOIN invoice_received ir ON ir.invoice_id = ii.invoice_id
     WHERE ${whereClause}`,
    cte.params,
  ).v;
}

export function registerCashflowHandlers(db) {
  ipcMain.handle(
    IPC_CHANNELS.CASHFLOW.SUMMARY,
    safe((event, token, filters = {}) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const scope = filters.scope || CASH_SCOPE.BUSINESS;
      const { fromDate, toDate, accountingMonth } = filters;

      const cashIn = sumLedger(db, { scope, direction: CASH_DIRECTION.IN, fromDate, toDate, accountingMonth });
      const cashOut = sumLedger(db, { scope, direction: CASH_DIRECTION.OUT, fromDate, toDate, accountingMonth });

      // Balance is always all-time-to-date for the scope — a running total,
      // not bounded by whatever period the caller is looking at.
      const balanceIn = sumLedger(db, { scope, direction: CASH_DIRECTION.IN });
      const balanceOut = sumLedger(db, { scope, direction: CASH_DIRECTION.OUT });

      // Opening balance = the running balance strictly BEFORE this period
      // started, so Opening + (cashIn - cashOut) = Closing (= `balance` when
      // the period runs through today). Only meaningful when the caller
      // actually bounded the period; with no period, there's no "before".
      let openingBalance = null;
      const cutoff = accountingMonth ? `${accountingMonth}-01` : fromDate;
      if (cutoff) {
        const beforeIn = db.get(
          "SELECT COALESCE(SUM(amount), 0) as v FROM cash_transactions WHERE scope = ? AND direction = 'in' AND txn_date < ?",
          [scope, cutoff],
        ).v;
        const beforeOut = db.get(
          "SELECT COALESCE(SUM(amount), 0) as v FROM cash_transactions WHERE scope = ? AND direction = 'out' AND txn_date < ?",
          [scope, cutoff],
        ).v;
        openingBalance = beforeIn - beforeOut;
      }

      return {
        success: true,
        data: { cashIn, cashOut, net: cashIn - cashOut, balance: balanceIn - balanceOut, openingBalance },
      };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.CASHFLOW.TRANSACTIONS,
    safe((event, token, filters = {}) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const scope = filters.scope || CASH_SCOPE.BUSINESS;
      const { where, params } = buildLedgerWhere({
        scope,
        direction: filters.direction,
        fromDate: filters.fromDate,
        toDate: filters.toDate,
        accountingMonth: filters.accountingMonth,
      });
      const limit = filters.limit || 100;

      const data = db.all(
        `SELECT * FROM cash_transactions ${where} ORDER BY txn_date DESC, id DESC LIMIT ?`,
        [...params, limit],
      );
      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.CASHFLOW.INCOME_BY_SOURCE,
    safe((event, token, filters = {}) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const scope = filters.scope || CASH_SCOPE.BUSINESS;
      const { where, params } = buildLedgerWhere({
        scope,
        direction: CASH_DIRECTION.IN,
        fromDate: filters.fromDate,
        toDate: filters.toDate,
        accountingMonth: filters.accountingMonth,
      });

      const data = db.all(
        `SELECT source_type, COALESCE(SUM(amount), 0) as total
         FROM cash_transactions ${where}
         GROUP BY source_type
         ORDER BY total DESC`,
        params,
      );
      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.CASHFLOW.EXPENSES_BY_CATEGORY,
    safe((event, token, filters = {}) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const scope = filters.scope || CASH_SCOPE.BUSINESS;
      const { where, params } = buildLedgerWhere({
        scope,
        direction: CASH_DIRECTION.OUT,
        fromDate: filters.fromDate,
        toDate: filters.toDate,
        accountingMonth: filters.accountingMonth,
        alias: "ct",
      });

      const data = db.all(
        `SELECT
           COALESCE(e.category, CASE WHEN ct.source_type = 'purchase_payment' THEN 'Supplier Purchases' ELSE 'Other' END) as category,
           COALESCE(SUM(ct.amount), 0) as total
         FROM cash_transactions ct
         LEFT JOIN expenses e ON ct.source_type = 'expense' AND ct.source_id = e.id
         ${where}
         GROUP BY category
         ORDER BY total DESC`,
        params,
      );
      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.CASHFLOW.BY_PAYMENT_METHOD,
    safe((event, token, filters = {}) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const scope = filters.scope || CASH_SCOPE.BUSINESS;
      const { where, params } = buildLedgerWhere({
        scope,
        direction: filters.direction,
        fromDate: filters.fromDate,
        toDate: filters.toDate,
        accountingMonth: filters.accountingMonth,
      });

      const data = db.all(
        `SELECT COALESCE(method, 'unspecified') as method, direction, COALESCE(SUM(amount), 0) as total
         FROM cash_transactions ${where}
         GROUP BY method, direction
         ORDER BY total DESC`,
        params,
      );
      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.CASHFLOW.DASHBOARD,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const scope = CASH_SCOPE.BUSINESS;
      const today = new Date().toISOString().split("T")[0];
      const month = today.slice(0, 7);

      const todayIn = sumLedger(db, { scope, direction: CASH_DIRECTION.IN, fromDate: today, toDate: today });
      const todayOut = sumLedger(db, { scope, direction: CASH_DIRECTION.OUT, fromDate: today, toDate: today });
      const salesReceivedToday = db.get(
        `SELECT COALESCE(SUM(amount), 0) as v FROM cash_transactions
         WHERE scope = ? AND direction = 'in' AND source_type = 'invoice_payment' AND txn_date = ?`,
        [scope, today],
      ).v;
      // "Sales" is an activity figure (today's invoiced total, whether or
      // not it's been collected yet) — distinct from salesReceived, which
      // is real cash in. Deliberately accrual, deliberately labeled as
      // such, never treated as cash.
      const salesToday = db.get(
        "SELECT COALESCE(SUM(total), 0) as v FROM invoices WHERE issue_date = ?",
        [today],
      ).v;

      const monthIn = sumLedger(db, { scope, direction: CASH_DIRECTION.IN, accountingMonth: month });
      const monthOut = sumLedger(db, { scope, direction: CASH_DIRECTION.OUT, accountingMonth: month });

      // Category figures for the month — cost categories stay accrual
      // (matches how Total Cost works everywhere else: incurred, not just
      // paid), revenue categories stay cash/prorated (matches the Workshop
      // reports' existing formula, just month-scoped instead of all-time).
      const projectRevenue = categoryRevenueForMonth(db, month, "i.project_id IS NOT NULL");
      const workshopRevenue = categoryRevenueForMonth(db, month, "ii.service_id IS NOT NULL");
      const hardwareRevenue = categoryRevenueForMonth(db, month, "ii.product_id IS NOT NULL");
      const purchasesThisMonth = db.get(
        "SELECT COALESCE(SUM(total), 0) as v FROM purchases WHERE accounting_month = ?",
        [month],
      ).v;
      const wagesThisMonth = db.get(
        "SELECT COALESCE(SUM(amount), 0) as v FROM expenses WHERE worker_id IS NOT NULL AND accounting_month = ?",
        [month],
      ).v;
      const rentThisMonth = db.get(
        "SELECT COALESCE(SUM(amount), 0) as v FROM expenses WHERE category = 'Rent' AND accounting_month = ?",
        [month],
      ).v;

      const balanceIn = sumLedger(db, { scope, direction: CASH_DIRECTION.IN });
      const balanceOut = sumLedger(db, { scope, direction: CASH_DIRECTION.OUT });

      const recentTransactions = db.all(
        "SELECT * FROM cash_transactions WHERE scope = ? ORDER BY txn_date DESC, id DESC LIMIT 8",
        [scope],
      );
      const recentExpenses = db.all(
        "SELECT * FROM expenses WHERE scope = ? ORDER BY expense_date DESC, id DESC LIMIT 8",
        [scope],
      );
      const recentPayments = db.all(
        `SELECT pay.*, i.invoice_number, c.name as client_name
         FROM payments pay
         JOIN invoices i ON i.id = pay.invoice_id
         JOIN clients c ON c.id = i.client_id
         ORDER BY pay.payment_date DESC, pay.id DESC LIMIT 8`,
      );

      return {
        success: true,
        data: {
          today: {
            cashIn: todayIn,
            cashOut: todayOut,
            net: todayIn - todayOut,
            salesReceived: salesReceivedToday,
            expenses: todayOut,
            sales: salesToday,
          },
          month: {
            income: monthIn,
            expenses: monthOut,
            net: monthIn - monthOut,
            outstanding: outstandingReceivables(db),
            projectRevenue,
            workshopRevenue,
            hardwareRevenue,
            purchases: purchasesThisMonth,
            wages: wagesThisMonth,
            rent: rentThisMonth,
            supplierPayables: outstandingPayables(db),
          },
          balance: balanceIn - balanceOut,
          recentTransactions,
          recentExpenses,
          recentPayments,
        },
      };
    }),
  );
}
