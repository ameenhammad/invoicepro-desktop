import { CASH_DIRECTION, CASH_SCOPE } from "../shared/constants.js";

// The cash ledger (cash_transactions) is the single source of truth for
// actual cash movement. Documents — invoices, expenses, and later
// purchases — never post here directly; only their settlement rows do, via
// the functions below, called from inside the same db.transaction() as the
// settlement row itself so the writes commit or roll back together.

export function toAccountingMonth(txnDate) {
  if (!txnDate || !/^\d{4}-\d{2}-\d{2}$/.test(txnDate)) {
    throw new Error(`Invalid transaction date for accounting month: ${txnDate}`);
  }
  return txnDate.slice(0, 7);
}

function isValidAccountingMonth(value) {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

function validateLedgerFields({ direction, scope, amount, sourceType, sourceId }) {
  if (direction !== CASH_DIRECTION.IN && direction !== CASH_DIRECTION.OUT) {
    throw new Error(`Invalid ledger direction: ${direction}`);
  }
  if (scope !== CASH_SCOPE.BUSINESS && scope !== CASH_SCOPE.PERSONAL) {
    throw new Error(`Invalid ledger scope: ${scope}`);
  }
  if (!amount || amount <= 0) {
    throw new Error(`Invalid ledger amount: ${amount}`);
  }
  if (!sourceType || !sourceId) {
    throw new Error("Ledger entries require sourceType and sourceId");
  }
}

// `db` is the InvoiceDatabase wrapper (same one every IPC handler uses),
// not the raw better-sqlite3 connection.
//
// accountingMonth defaults to txnDate's own month (invoice payments always
// use this), but callers that let the user assign a different month than
// the transaction date — expenses — can pass it explicitly.
export function postLedgerEntry(
  db,
  { direction, scope = CASH_SCOPE.BUSINESS, amount, txnDate, accountingMonth, method, sourceType, sourceId, description },
) {
  validateLedgerFields({ direction, scope, amount, sourceType, sourceId });

  const resolvedMonth = accountingMonth || toAccountingMonth(txnDate);
  if (!isValidAccountingMonth(resolvedMonth)) {
    throw new Error(`Invalid accounting month: ${resolvedMonth}`);
  }

  // No OR IGNORE here: on the live path a duplicate (source_type, source_id)
  // means a real bug (e.g. double-posting the same payment), and the unique
  // index should throw loudly so the whole transaction rolls back — not
  // silently swallow it the way the one-time backfill migration does.
  db.run(
    `INSERT INTO cash_transactions
       (direction, scope, amount, txn_date, accounting_month, method, source_type, source_id, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [direction, scope, amount, txnDate, resolvedMonth, method || null, sourceType, sourceId, description || null],
  );
}

// Updates a settlement's existing ledger row in place — used when editing a
// still-paid expense, so the ledger row's identity (id, created_at) is
// preserved rather than deleting and re-inserting on every edit. Throws if
// no matching row exists, since that means the ledger has already drifted
// from the source record it's supposed to mirror.
export function updateLedgerEntry(
  db,
  { sourceType, sourceId, direction, scope = CASH_SCOPE.BUSINESS, amount, txnDate, accountingMonth, method, description },
) {
  validateLedgerFields({ direction, scope, amount, sourceType, sourceId });

  const resolvedMonth = accountingMonth || toAccountingMonth(txnDate);
  if (!isValidAccountingMonth(resolvedMonth)) {
    throw new Error(`Invalid accounting month: ${resolvedMonth}`);
  }

  const result = db.run(
    `UPDATE cash_transactions
       SET direction = ?, scope = ?, amount = ?, txn_date = ?, accounting_month = ?, method = ?, description = ?
     WHERE source_type = ? AND source_id = ?`,
    [direction, scope, amount, txnDate, resolvedMonth, method || null, description || null, sourceType, sourceId],
  );
  if (result.changes === 0) {
    throw new Error(`No ledger entry found to update for ${sourceType}:${sourceId}`);
  }
}

export function reverseLedgerEntry(db, { sourceType, sourceId }) {
  db.run("DELETE FROM cash_transactions WHERE source_type = ? AND source_id = ?", [sourceType, sourceId]);
}
