import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/constants.js";
import { requireAuth, safe } from "./helpers.js";

export function registerClientHandlers(db) {
  ipcMain.handle(
    IPC_CHANNELS.CLIENTS.GET_ALL,
    safe((event, token, search) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      let sql = "SELECT * FROM clients WHERE is_active = 1";
      const params = [];
      if (search) {
        sql += " AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)";
        const term = `%${search}%`;
        params.push(term, term, term);
      }
      sql += " ORDER BY name ASC";

      return { success: true, data: db.all(sql, params) };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.CLIENTS.GET,
    safe((event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const client = db.get("SELECT * FROM clients WHERE id = ?", [id]);
      if (!client)
        return {
          success: false,
          error: { code: "NOT_FOUND", message: "Client not found" },
        };
      return { success: true, data: client };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.CLIENTS.CREATE,
    safe((event, token, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const {
        name,
        email,
        phone,
        address_line1,
        address_line2,
        city,
        state,
        postal_code,
        country,
      } = data;

      if (!name)
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Client name is required",
          },
        };

      const result = db.run(
        `INSERT INTO clients (name, email, phone, address_line1, address_line2, city, state, postal_code, country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name,
          email || "",
          phone || "",
          address_line1 || "",
          address_line2 || "",
          city || "",
          state || "",
          postal_code || "",
          country || "Pakistan",
        ],
      );

      return { success: true, data: { id: result.lastInsertRowid } };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.CLIENTS.UPDATE,
    safe((event, token, id, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const {
        name,
        email,
        phone,
        address_line1,
        address_line2,
        city,
        state,
        postal_code,
        country,
        is_active,
      } = data;

      db.run(
        `UPDATE clients SET name = ?, email = ?, phone = ?, address_line1 = ?, address_line2 = ?,
       city = ?, state = ?, postal_code = ?, country = ?, is_active = ? WHERE id = ?`,
        [
          name,
          email || "",
          phone || "",
          address_line1 || "",
          address_line2 || "",
          city || "",
          state || "",
          postal_code || "",
          country || "Pakistan",
          is_active ?? 1,
          id,
        ],
      );

      return {
        success: true,
        data: db.get("SELECT * FROM clients WHERE id = ?", [id]),
      };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.CLIENTS.DELETE,
    safe((event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const walkinId = db.get(
        "SELECT value FROM settings WHERE key = 'default_walkin_client_id'",
      )?.value;
      if (walkinId && Number(walkinId) === Number(id))
        return {
          success: false,
          error: {
            code: "PROTECTED_CLIENT",
            message: "The default Walk-in Customer cannot be deleted",
          },
        };

      const invoiceCount = db.get(
        "SELECT COUNT(*) as count FROM invoices WHERE client_id = ?",
        [id],
      ).count;
      if (invoiceCount > 0)
        return {
          success: false,
          error: {
            code: "HAS_INVOICES",
            message: "Cannot delete client with existing invoices",
          },
        };

      db.run("UPDATE clients SET is_active = 0 WHERE id = ?", [id]);
      return { success: true };
    }),
  );
}
