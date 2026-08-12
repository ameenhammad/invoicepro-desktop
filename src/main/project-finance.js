import { INVOICE_STATUS } from "../shared/constants.js";

// Single source of truth for "how much has this project actually made."
// Every screen that shows project numbers (list, detail, dashboard) calls
// this — never re-derives revenue/cost with its own SQL — so the numbers
// can never disagree with each other.
//
// Two deliberately different accounting bases, matching how the rest of
// the app already treats invoices vs. the ledger:
//   - Revenue is CASH-BASIS: only payments that have actually posted to
//     cash_transactions count, joined through payments -> invoices. An
//     unpaid or partially-paid invoice contributes nothing to "received."
//   - Cost is ACCRUAL-BASIS: every expense AND every supplier purchase
//     linked to the project counts the moment it's recorded, whether or not
//     it's been paid yet — a bag of screws bought on credit is still a real
//     cost of the job today. Worker wages need no separate handling here —
//     they're just expenses with worker_id set, so they're already inside
//     the expense sum below.
// Both reuse the existing tables/ledger as-is; nothing here writes
// anything or posts a second time to cash_transactions.
export function computeProjectFinancials(db, projectId) {
  const project = db.get("SELECT * FROM projects WHERE id = ?", [projectId]);
  if (!project) return null;

  const invoiceTotals = db.get(
    `SELECT
       COALESCE(SUM(i.total), 0) as invoiced,
       COALESCE(SUM(CASE WHEN i.status IN (?, ?) THEN i.total - COALESCE(pd.paid, 0) ELSE 0 END), 0) as outstanding
     FROM invoices i
     LEFT JOIN (SELECT invoice_id, SUM(amount) as paid FROM payments GROUP BY invoice_id) pd
       ON pd.invoice_id = i.id
     WHERE i.project_id = ?`,
    [INVOICE_STATUS.PENDING, INVOICE_STATUS.PARTIAL, projectId],
  );

  // Amount actually received — the ledger, joined through payments through
  // invoices. This is "Project Revenue": actual invoice payments through
  // the existing ledger, per the architecture rule, not the invoiced total.
  const amountReceived = db.get(
    `SELECT COALESCE(SUM(ct.amount), 0) as v
     FROM cash_transactions ct
     JOIN payments p ON ct.source_type = 'invoice_payment' AND ct.source_id = p.id
     JOIN invoices i ON i.id = p.invoice_id
     WHERE i.project_id = ? AND ct.direction = 'in'`,
    [projectId],
  ).v;

  const costBreakdown = db.all(
    "SELECT category, COALESCE(SUM(amount), 0) as total FROM expenses WHERE project_id = ? GROUP BY category ORDER BY total DESC",
    [projectId],
  );

  const purchaseCost = db.get("SELECT COALESCE(SUM(total), 0) as v FROM purchases WHERE project_id = ?", [projectId]).v;
  if (purchaseCost > 0) {
    costBreakdown.push({ category: "Supplier Purchases", total: purchaseCost });
    costBreakdown.sort((a, b) => b.total - a.total);
  }

  const totalCost = costBreakdown.reduce((sum, row) => sum + row.total, 0);

  // How much of that cost has actually been paid out (cash-basis), for
  // reference — not used in the profit calculation itself.
  const expenseCostPaid = db.get(
    `SELECT COALESCE(SUM(ct.amount), 0) as v
     FROM cash_transactions ct
     JOIN expenses e ON ct.source_type = 'expense' AND ct.source_id = e.id
     WHERE e.project_id = ? AND ct.direction = 'out'`,
    [projectId],
  ).v;
  const purchaseCostPaid = db.get(
    `SELECT COALESCE(SUM(ct.amount), 0) as v
     FROM cash_transactions ct
     JOIN purchase_payments pp ON ct.source_type = 'purchase_payment' AND ct.source_id = pp.id
     JOIN purchases pu ON pu.id = pp.purchase_id
     WHERE pu.project_id = ? AND ct.direction = 'out'`,
    [projectId],
  ).v;
  const costPaid = expenseCostPaid + purchaseCostPaid;

  const revenue = amountReceived;
  const profit = revenue - totalCost;
  const profitMargin = revenue > 0 ? (profit / revenue) * 100 : null;

  // Before the job is fully paid (or even invoiced), the quoted/contract
  // amount is the best stand-in for "what this will eventually earn" —
  // useful during Quotation/In Progress, before actual revenue exists.
  const estimatedProfit = project.quoted_amount - totalCost;
  const estimatedProfitMargin = project.quoted_amount > 0 ? (estimatedProfit / project.quoted_amount) * 100 : null;

  return {
    project,
    invoiced: invoiceTotals.invoiced,
    outstanding: invoiceTotals.outstanding,
    revenue,
    amountReceived,
    totalCost,
    costPaid,
    costBreakdown,
    profit,
    profitMargin,
    estimatedProfit,
    estimatedProfitMargin,
  };
}
