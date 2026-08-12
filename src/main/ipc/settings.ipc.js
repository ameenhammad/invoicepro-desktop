import { ipcMain } from "electron";
import { IPC_CHANNELS, PAYMENT_METHODS } from "../../shared/constants.js";
import { requireAuth, safe } from "./helpers.js";

const KNOWN_KEYS = [
  "default_walkin_client_id",
  "default_payment_method",
  "invoice_prefix",
  "currency_symbol",
  "tax_rate",
];

function fetchKnownSettings(db) {
  const rows = db.all(
    `SELECT key, value FROM settings WHERE key IN (${KNOWN_KEYS.map(() => "?").join(",")})`,
    KNOWN_KEYS,
  );
  const obj = {};
  for (const row of rows) obj[row.key] = row.value;
  return obj;
}

// App-wide workshop settings (invoice prefix, currency, tax rate, default
// walk-in client, default payment method) — stored as key/value pairs,
// distinct from the per-user company profile handled in auth.js.
export function registerSettingsHandlers(db) {
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS.GET_APP_SETTINGS,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      return { success: true, data: fetchKnownSettings(db) };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS.UPDATE_APP_SETTINGS,
    safe((event, token, updates) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      if (
        updates.default_payment_method &&
        !Object.values(PAYMENT_METHODS).includes(updates.default_payment_method)
      )
        return {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid payment method" },
        };

      if (updates.invoice_prefix !== undefined && !updates.invoice_prefix.trim())
        return {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invoice prefix cannot be empty" },
        };

      if (updates.currency_symbol !== undefined && !updates.currency_symbol.trim())
        return {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Currency symbol cannot be empty" },
        };

      if (updates.tax_rate !== undefined) {
        const rate = parseFloat(updates.tax_rate);
        if (isNaN(rate) || rate < 0)
          return {
            success: false,
            error: { code: "VALIDATION_ERROR", message: "Tax rate must be a positive number" },
          };
      }

      if (updates.default_walkin_client_id !== undefined) {
        const client = db.get("SELECT id FROM clients WHERE id = ?", [
          updates.default_walkin_client_id,
        ]);
        if (!client)
          return {
            success: false,
            error: { code: "VALIDATION_ERROR", message: "Selected client not found" },
          };
      }

      for (const key of KNOWN_KEYS) {
        if (updates[key] === undefined) continue;
        db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [
          key,
          String(updates[key]),
        ]);
      }

      return { success: true, data: fetchKnownSettings(db) };
    }),
  );
}
