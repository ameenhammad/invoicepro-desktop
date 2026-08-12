import { STOCK_MOVEMENT_REASON } from "../shared/constants.js";

// product_variants.quantity must never be written directly — every mutation
// goes through recordStockMovement() so the movement log and the cached
// quantity can never drift apart (same discipline as ledger.js for cash).
// Call this from inside the caller's own db.transaction(); it doesn't open
// one itself.

const VALID_REASONS = Object.values(STOCK_MOVEMENT_REASON);

// `db` is the InvoiceDatabase wrapper, same as every IPC handler uses.
export function recordStockMovement(db, { variantId, changeQty, reason, referenceType, referenceId, notes }) {
  if (!variantId) {
    throw new Error("Stock movement requires variantId");
  }
  if (!changeQty) {
    throw new Error("Stock movement changeQty cannot be zero");
  }
  if (!VALID_REASONS.includes(reason)) {
    throw new Error(`Invalid stock movement reason: ${reason}`);
  }

  const variant = db.get("SELECT quantity FROM product_variants WHERE id = ?", [variantId]);
  if (!variant) {
    throw new Error(`Variant not found: ${variantId}`);
  }

  const quantityBefore = variant.quantity;
  const quantityAfter = quantityBefore + changeQty;
  if (quantityAfter < 0) {
    throw new Error(
      `Stock movement would result in negative stock (variant ${variantId}: ${quantityBefore} ${changeQty >= 0 ? "+" : ""}${changeQty})`,
    );
  }

  db.run("UPDATE product_variants SET quantity = ? WHERE id = ?", [quantityAfter, variantId]);
  db.run(
    `INSERT INTO stock_movements
       (variant_id, change_qty, quantity_before, quantity_after, reason, reference_type, reference_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [variantId, changeQty, quantityBefore, quantityAfter, reason, referenceType || null, referenceId || null, notes || null],
  );

  return quantityAfter;
}
