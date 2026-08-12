import { ipcMain } from "electron";
import { IPC_CHANNELS, PRODUCT_CATEGORIES, STOCK_MOVEMENT_REASON } from "../../shared/constants.js";
import { requireAuth, safe } from "./helpers.js";
import { recordStockMovement } from "../stock.js";

function normalizeCategory(category) {
  return PRODUCT_CATEGORIES.includes(category) ? category : "Other";
}

export function registerProductHandlers(db) {
  // ============ PRODUCTS ============
  ipcMain.handle(
    IPC_CHANNELS.PRODUCTS.GET_ALL,
    safe((event, token, search) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      // Inactive products stay visible (with a status badge) rather than
      // disappearing, so they can be found again and reactivated.
      let sql = `SELECT p.*,
               (SELECT COUNT(*) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = 1) as variant_count,
               (SELECT SUM(pv.quantity) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = 1) as total_stock,
               (SELECT COUNT(*) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = 1 AND pv.quantity <= pv.low_stock_threshold) as low_stock_count
               FROM products p WHERE 1=1`;
      const params = [];
      if (search) {
        sql += " AND (p.name LIKE ? OR p.description LIKE ?)";
        const term = `%${search}%`;
        params.push(term, term);
      }
      sql += " ORDER BY p.is_active DESC, p.name ASC";

      return { success: true, data: db.all(sql, params) };
    }),
  );

  const getProductWithVariants = (event, token, id) => {
    const auth = requireAuth(token);
    if (!auth.ok) return auth.error;

    const product = db.get("SELECT * FROM products WHERE id = ?", [id]);
    if (!product)
      return {
        success: false,
        error: { code: "NOT_FOUND", message: "Product not found" },
      };

    const variants = db.all(
      "SELECT * FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY size_name ASC",
      [id],
    );

    return { success: true, data: { ...product, variants } };
  };

  ipcMain.handle(IPC_CHANNELS.PRODUCTS.GET, safe(getProductWithVariants));
  // GET_WITH_VARIANTS is identical to GET — the renderer only needs one shape.
  ipcMain.handle(
    IPC_CHANNELS.PRODUCTS.GET_WITH_VARIANTS,
    safe(getProductWithVariants),
  );

  ipcMain.handle(
    IPC_CHANNELS.PRODUCTS.CREATE,
    safe((event, token, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const { name, description, category } = data;
      if (!name)
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Product name is required",
          },
        };

      const result = db.run(
        "INSERT INTO products (name, description, category) VALUES (?, ?, ?)",
        [name, description || "", normalizeCategory(category)],
      );

      return { success: true, data: { id: result.lastInsertRowid } };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.PRODUCTS.UPDATE,
    safe((event, token, id, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const { name, description, category, is_active } = data;
      db.run(
        "UPDATE products SET name = ?, description = ?, category = ?, is_active = ? WHERE id = ?",
        [name, description || "", normalizeCategory(category), is_active ?? 1, id],
      );

      const product = db.get("SELECT * FROM products WHERE id = ?", [id]);
      const variants = db.all(
        "SELECT * FROM product_variants WHERE product_id = ? AND is_active = 1",
        [id],
      );

      return { success: true, data: { ...product, variants } };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.PRODUCTS.DELETE,
    safe((event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      db.run("UPDATE products SET is_active = 0 WHERE id = ?", [id]);
      return { success: true };
    }),
  );

  // ============ PRODUCT VARIANTS ============
  ipcMain.handle(
    IPC_CHANNELS.PRODUCTS.GET_VARIANTS,
    safe((event, token, productId) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const variants = db.all(
        "SELECT * FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY size_name ASC",
        [productId],
      );
      return { success: true, data: variants };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.PRODUCTS.ADD_VARIANT,
    safe((event, token, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const {
        product_id,
        size_name,
        sku,
        price,
        cost_price,
        quantity,
        low_stock_threshold,
      } = data;

      if (!product_id || !size_name)
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Product and size name are required",
          },
        };

      if ((quantity ?? 0) < 0)
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Stock quantity cannot be negative",
          },
        };

      const initialQuantity = quantity || 0;

      const variantId = db.transaction(() => {
        // Insert at 0 and let recordStockMovement bring it up to the
        // requested opening quantity, so even a brand-new variant's stock
        // is traceable from its very first movement.
        const result = db.run(
          `INSERT INTO product_variants (product_id, size_name, sku, price, cost_price, quantity, low_stock_threshold)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
          [
            product_id,
            size_name,
            sku || "",
            price || 0,
            cost_price || 0,
            low_stock_threshold || 10,
          ],
        );
        const newVariantId = result.lastInsertRowid;

        if (initialQuantity > 0) {
          recordStockMovement(db, {
            variantId: newVariantId,
            changeQty: initialQuantity,
            reason: STOCK_MOVEMENT_REASON.STOCK_IN,
            referenceType: "manual",
            notes: "Opening stock for new variant",
          });
        }

        return newVariantId;
      })();

      return { success: true, data: { id: variantId } };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.PRODUCTS.UPDATE_VARIANT,
    safe((event, token, id, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const existing = db.get("SELECT * FROM product_variants WHERE id = ?", [id]);
      if (!existing)
        return {
          success: false,
          error: { code: "NOT_FOUND", message: "Variant not found" },
        };

      const {
        size_name,
        sku,
        price,
        cost_price,
        quantity,
        low_stock_threshold,
        is_active,
      } = data;

      if (quantity !== undefined && quantity < 0)
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Stock quantity cannot be negative",
          },
        };

      db.transaction(() => {
        // Quantity is deliberately NOT in this UPDATE — it's only ever
        // changed through recordStockMovement below, so every change stays
        // traceable in stock_movements even when it comes from this
        // "just edit the number" field rather than the dedicated Adjust
        // Stock action.
        db.run(
          `UPDATE product_variants SET size_name = ?, sku = ?, price = ?, cost_price = ?, low_stock_threshold = ?, is_active = ? WHERE id = ?`,
          [
            size_name,
            sku || "",
            price || 0,
            cost_price ?? existing.cost_price,
            low_stock_threshold ?? 10,
            is_active ?? 1,
            id,
          ],
        );

        const resolvedQuantity = quantity ?? existing.quantity;
        const delta = resolvedQuantity - existing.quantity;
        if (delta !== 0) {
          recordStockMovement(db, {
            variantId: id,
            changeQty: delta,
            reason: STOCK_MOVEMENT_REASON.ADJUSTMENT,
            referenceType: "manual",
            notes: "Quantity corrected via Edit Product",
          });
        }
      })();

      return {
        success: true,
        data: db.get("SELECT * FROM product_variants WHERE id = ?", [id]),
      };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.PRODUCTS.DELETE_VARIANT,
    safe((event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      db.run("UPDATE product_variants SET is_active = 0 WHERE id = ?", [id]);
      return { success: true };
    }),
  );

  // Explicit, reason-tagged stock changes outside of a sale — the
  // "Stock In" / "Stock Out" / "Adjustment" actions from the Products page.
  ipcMain.handle(
    IPC_CHANNELS.PRODUCTS.ADJUST_STOCK,
    safe((event, token, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const { variant_id, type, quantity, notes } = data || {};
      const variant = db.get("SELECT * FROM product_variants WHERE id = ?", [variant_id]);
      if (!variant)
        return { success: false, error: { code: "NOT_FOUND", message: "Variant not found" } };

      const qty = parseFloat(quantity);
      if (!qty || qty <= 0)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Quantity must be positive" } };

      try {
        db.transaction(() => {
          if (type === "stock_in") {
            recordStockMovement(db, {
              variantId: variant_id,
              changeQty: qty,
              reason: STOCK_MOVEMENT_REASON.STOCK_IN,
              referenceType: "manual",
              notes: notes || "Stock received",
            });
          } else if (type === "stock_out") {
            recordStockMovement(db, {
              variantId: variant_id,
              changeQty: -qty,
              reason: STOCK_MOVEMENT_REASON.STOCK_OUT,
              referenceType: "manual",
              notes: notes || "Stock removed",
            });
          } else if (type === "adjustment") {
            // `quantity` here is the new absolute count, not a delta.
            const delta = qty - variant.quantity;
            if (delta !== 0) {
              recordStockMovement(db, {
                variantId: variant_id,
                changeQty: delta,
                reason: STOCK_MOVEMENT_REASON.ADJUSTMENT,
                referenceType: "manual",
                notes: notes || "Manual stock count adjustment",
              });
            }
          } else {
            throw new Error(`Invalid stock adjustment type: ${type}`);
          }
        })();
      } catch (err) {
        return { success: false, error: { code: "VALIDATION_ERROR", message: err.message } };
      }

      return { success: true, data: db.get("SELECT * FROM product_variants WHERE id = ?", [variant_id]) };
    }),
  );
}
