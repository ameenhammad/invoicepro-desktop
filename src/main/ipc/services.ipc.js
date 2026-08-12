import { ipcMain } from "electron";
import { IPC_CHANNELS, SERVICE_UNITS } from "../../shared/constants.js";
import { requireAuth, safe } from "./helpers.js";

function normalizeUnit(unit) {
  return SERVICE_UNITS.includes(unit) ? unit : "Piece";
}

// Services (e.g. Sheet Cutting, Edge Banding) are invoiceable like products
// but have no stock/variants — a single flat price per service. Soft-deleted
// via is_active, matching the products/clients pattern.
export function registerServiceHandlers(db) {
  ipcMain.handle(
    IPC_CHANNELS.SERVICES.GET_ALL,
    safe((event, token, search) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      let sql = "SELECT * FROM services WHERE is_active = 1";
      const params = [];
      if (search) {
        sql += " AND (name LIKE ? OR description LIKE ?)";
        const term = `%${search}%`;
        params.push(term, term);
      }
      sql += " ORDER BY name ASC";

      return { success: true, data: db.all(sql, params) };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.SERVICES.GET,
    safe((event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const service = db.get("SELECT * FROM services WHERE id = ?", [id]);
      if (!service)
        return {
          success: false,
          error: { code: "NOT_FOUND", message: "Service not found" },
        };
      return { success: true, data: service };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.SERVICES.CREATE,
    safe((event, token, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const { name, description, price, unit } = data;
      if (!name)
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Service name is required",
          },
        };
      if (price !== undefined && price < 0)
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Price cannot be negative",
          },
        };

      const result = db.run(
        "INSERT INTO services (name, description, price, unit) VALUES (?, ?, ?, ?)",
        [name, description || "", price || 0, normalizeUnit(unit)],
      );

      return { success: true, data: { id: result.lastInsertRowid } };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.SERVICES.UPDATE,
    safe((event, token, id, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const { name, description, price, is_active, unit } = data;
      if (price !== undefined && price < 0)
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Price cannot be negative",
          },
        };

      db.run(
        "UPDATE services SET name = ?, description = ?, price = ?, is_active = ?, unit = ? WHERE id = ?",
        [name, description || "", price || 0, is_active ?? 1, normalizeUnit(unit), id],
      );

      return {
        success: true,
        data: db.get("SELECT * FROM services WHERE id = ?", [id]),
      };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.SERVICES.DELETE,
    safe((event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      db.run("UPDATE services SET is_active = 0 WHERE id = ?", [id]);
      return { success: true };
    }),
  );
}
