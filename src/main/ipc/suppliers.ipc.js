import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/constants.js";
import { requireAuth, safe } from "./helpers.js";

// Suppliers (see also product_variants.supplier_id and purchases.supplier_id).
// Soft-deleted via is_active, matching clients/services/products.
export function registerSupplierHandlers(db) {
  ipcMain.handle(
    IPC_CHANNELS.SUPPLIERS.GET_ALL,
    safe((event, token, search) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      let sql = "SELECT * FROM suppliers WHERE is_active = 1";
      const params = [];
      if (search) {
        sql += " AND (name LIKE ? OR phone LIKE ?)";
        const term = `%${search}%`;
        params.push(term, term);
      }
      sql += " ORDER BY name ASC";

      return { success: true, data: db.all(sql, params) };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.SUPPLIERS.GET,
    safe((event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const supplier = db.get("SELECT * FROM suppliers WHERE id = ?", [id]);
      if (!supplier)
        return { success: false, error: { code: "NOT_FOUND", message: "Supplier not found" } };
      return { success: true, data: supplier };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.SUPPLIERS.CREATE,
    safe((event, token, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const { name, phone, address, notes } = data || {};
      if (!name)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Supplier name is required" } };

      const result = db.run(
        "INSERT INTO suppliers (name, phone, address, notes) VALUES (?, ?, ?, ?)",
        [name, phone || "", address || "", notes || ""],
      );

      return { success: true, data: { id: result.lastInsertRowid } };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.SUPPLIERS.UPDATE,
    safe((event, token, id, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const { name, phone, address, notes, is_active } = data || {};
      if (!name)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Supplier name is required" } };

      db.run(
        "UPDATE suppliers SET name = ?, phone = ?, address = ?, notes = ?, is_active = ? WHERE id = ?",
        [name, phone || "", address || "", notes || "", is_active ?? 1, id],
      );

      return { success: true, data: db.get("SELECT * FROM suppliers WHERE id = ?", [id]) };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.SUPPLIERS.DELETE,
    safe((event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      db.run("UPDATE suppliers SET is_active = 0 WHERE id = ?", [id]);
      return { success: true };
    }),
  );
}
