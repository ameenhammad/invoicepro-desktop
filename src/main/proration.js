// Shared CTE for splitting invoice revenue by category on a CASH basis.
// A single payment can partially settle an invoice that mixes services and
// hardware, so there is no one ledger row that is "the service portion" —
// instead every line item's revenue is prorated by how much of its OWN
// invoice has actually been paid (via the ledger) in the requested period,
// then grouped however the caller needs. This guarantees
// SUM(prorated category A) + SUM(prorated category B) + ... always equals
// total cash received for that period — nothing invented, nothing
// double-counted. Centralized here so every report/dashboard figure that
// needs a category split reuses the exact same formula.
//
// With no filter, this reproduces the original all-time behavior exactly.
export function prorationCTE({ accountingMonth, fromDate, toDate } = {}) {
  const clauses = ["ct.direction = 'in'", "ct.scope = 'business'"];
  const params = [];

  if (accountingMonth) {
    clauses.push("ct.accounting_month = ?");
    params.push(accountingMonth);
  } else {
    if (fromDate) {
      clauses.push("ct.txn_date >= ?");
      params.push(fromDate);
    }
    if (toDate) {
      clauses.push("ct.txn_date <= ?");
      params.push(toDate);
    }
  }

  const sql = `
    WITH invoice_received AS (
      SELECT p.invoice_id, SUM(ct.amount) as received
      FROM cash_transactions ct
      JOIN payments p ON ct.source_type = 'invoice_payment' AND ct.source_id = p.id
      WHERE ${clauses.join(" AND ")}
      GROUP BY p.invoice_id
    ),
    invoice_item_totals AS (
      SELECT invoice_id, SUM(line_total) as items_total FROM invoice_items GROUP BY invoice_id
    )
  `;

  return { sql, params };
}

// The prorated revenue expression itself, reused verbatim everywhere.
export const PRORATED_REVENUE_EXPR =
  "ii.line_total * COALESCE(ir.received, 0) / NULLIF(it.items_total, 0)";
