import { ipcMain } from "electron";
import { generateInvoicePdf } from "../pdf-generator.js";
import { IPC_CHANNELS, INVOICE_STATUS, CASH_DIRECTION, CASH_SCOPE, CASH_SOURCE_TYPE, STOCK_MOVEMENT_REASON } from "../../shared/constants.js";
import { requireAuth, safe } from "./helpers.js";
import { postLedgerEntry, reverseLedgerEntry } from "../ledger.js";
import { recordStockMovement } from "../stock.js";

const INVOICE_DETAIL_SELECT = `SELECT i.*, c.name as client_name, c.email as client_email, c.phone as client_phone,
       c.address_line1 as client_address_line1, c.address_line2 as client_address_line2,
       c.city as client_city, c.state as client_state, c.postal_code as client_postal_code, c.country as client_country,
       pr.project_number as project_number, pr.name as project_name
       FROM invoices i JOIN clients c ON i.client_id = c.id
       LEFT JOIN projects pr ON pr.id = i.project_id
       WHERE i.id = ?`;

const INVOICE_ITEMS_SELECT = `SELECT ii.*, pv.size_name as variant_name, p.name as product_name, s.name as service_name, s.unit as service_unit
       FROM invoice_items ii
       LEFT JOIN product_variants pv ON ii.variant_id = pv.id
       LEFT JOIN products p ON ii.product_id = p.id
       LEFT JOIN services s ON ii.service_id = s.id
       WHERE ii.invoice_id = ?`;

function getSetting(db, key, fallback) {
  return db.get("SELECT value FROM settings WHERE key = ?", [key])?.value ?? fallback;
}

function insertInvoiceItems(db, invoiceId, items) {
  for (const item of items) {
    const result = db.run(
      "INSERT INTO invoice_items (invoice_id, product_id, variant_id, service_id, description, variant_name, quantity, unit_price, tax_percent, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        invoiceId,
        item.product_id || null,
        item.variant_id || null,
        item.service_id || null,
        item.description,
        item.variant_name || "",
        item.quantity,
        item.unit_price,
        item.tax_percent || 0,
        item.line_total,
      ],
    );
    // Only stocked product variants affect inventory — service items never
    // do, regardless of quantity/unit, since they have no variant_id.
    if (item.variant_id) {
      recordStockMovement(db, {
        variantId: item.variant_id,
        changeQty: -item.quantity,
        reason: STOCK_MOVEMENT_REASON.SALE,
        referenceType: "invoice_item",
        referenceId: result.lastInsertRowid,
        notes: `Sold via invoice #${invoiceId}`,
      });
    }
  }
}

function calculateTotals(items, discountPercent, taxPercent) {
  const subtotal = items.reduce((sum, item) => sum + (item.line_total || 0), 0);
  const discountAmount = subtotal * ((discountPercent || 0) / 100);
  const afterDiscount = subtotal - discountAmount;
  const taxAmount = afterDiscount * ((taxPercent || 0) / 100);
  const total = afterDiscount + taxAmount;
  return { subtotal, discountAmount, taxAmount, total };
}

export function registerInvoiceHandlers(db) {
  ipcMain.handle(
    IPC_CHANNELS.INVOICES.GET_ALL,
    safe((event, token, filters) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      let sql = `SELECT i.*, c.name as client_name, pr.project_number as project_number, pr.name as project_name,
               (SELECT SUM(amount) FROM payments WHERE invoice_id = i.id) as paid_amount
               FROM invoices i
               JOIN clients c ON i.client_id = c.id
               LEFT JOIN projects pr ON pr.id = i.project_id WHERE 1=1`;
      const params = [];

      if (filters) {
        if (filters.status) {
          sql += " AND i.status = ?";
          params.push(filters.status);
        }
        if (filters.clientId) {
          sql += " AND i.client_id = ?";
          params.push(filters.clientId);
        }
        if (filters.projectId) {
          sql += " AND i.project_id = ?";
          params.push(filters.projectId);
        }
        if (filters.fromDate) {
          sql += " AND i.issue_date >= ?";
          params.push(filters.fromDate);
        }
        if (filters.toDate) {
          sql += " AND i.issue_date <= ?";
          params.push(filters.toDate);
        }
      }

      sql += " ORDER BY i.created_at DESC";
      return { success: true, data: db.all(sql, params) };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.INVOICES.GET,
    safe((event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const invoice = db.get(INVOICE_DETAIL_SELECT, [id]);
      if (!invoice)
        return {
          success: false,
          error: { code: "NOT_FOUND", message: "Invoice not found" },
        };

      const items = db.all(INVOICE_ITEMS_SELECT, [id]);
      const payments = db.all(
        "SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC",
        [id],
      );

      return { success: true, data: { ...invoice, items, payments } };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.INVOICES.CREATE,
    safe((event, token, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const {
        client_id,
        status,
        issue_date,
        due_date,
        discount_percent,
        tax_percent,
        notes,
        items,
        payment_method,
        project_id,
      } = data;

      if (!client_id)
        return {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Client is required" },
        };
      if (!items || items.length === 0)
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "At least one item is required",
          },
        };
      if (project_id) {
        const project = db.get("SELECT id FROM projects WHERE id = ?", [project_id]);
        if (!project)
          return {
            success: false,
            error: { code: "VALIDATION_ERROR", message: "Project not found" },
          };
      }

      // Validate stock availability (product items only — services and
      // free-text items have no variant_id and skip this check).
      for (const item of items) {
        if (item.variant_id) {
          const variant = db.get(
            "SELECT * FROM product_variants WHERE id = ? AND is_active = 1",
            [item.variant_id],
          );
          if (!variant)
            return {
              success: false,
              error: {
                code: "VALIDATION_ERROR",
                message: `Variant not found for item: ${item.description}`,
              },
            };
          if (variant.quantity < item.quantity)
            return {
              success: false,
              error: {
                code: "INSUFFICIENT_STOCK",
                message: `Insufficient stock for ${item.description}. Available: ${variant.quantity}`,
              },
            };
        }
      }

      // Sequence lookup/increment happens inside the transaction to prevent races.
      const invoiceId = db.transaction(() => {
        const year = new Date().getFullYear();
        let seq = db.get(
          "SELECT last_number FROM invoice_sequence WHERE year = ?",
          [year],
        );
        if (!seq) {
          db.run(
            "INSERT INTO invoice_sequence (year, last_number) VALUES (?, 0)",
            [year],
          );
          seq = { last_number: 0 };
        }
        const nextNum = seq.last_number + 1;
        const prefix = getSetting(db, "invoice_prefix", "INV");
        const invoice_number = `${prefix}-${year}-${String(nextNum).padStart(4, "0")}`;

        const { subtotal, discountAmount, taxAmount, total } = calculateTotals(
          items,
          discount_percent,
          tax_percent,
        );
        const resolvedStatus = status || INVOICE_STATUS.PENDING;

        const result = db.run(
          `INSERT INTO invoices (invoice_number, client_id, status, issue_date, due_date, subtotal, discount_percent, discount_amount, tax_percent, tax_amount, total, notes, project_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            invoice_number,
            client_id,
            resolvedStatus,
            issue_date,
            due_date,
            subtotal,
            discount_percent || 0,
            discountAmount,
            tax_percent || 0,
            taxAmount,
            total,
            notes || "",
            project_id || null,
          ],
        );
        const newInvoiceId = result.lastInsertRowid;

        insertInvoiceItems(db, newInvoiceId, items);

        // Walk-in invoices are usually marked Paid at creation — record the
        // matching payment now so payment totals, the PDF, and reports all
        // stay consistent with the status (rather than "Paid" with $0 paid).
        // This is real cash movement bundled into invoice creation, so it
        // posts to the ledger exactly like any other payment does.
        if (resolvedStatus === INVOICE_STATUS.PAID && total > 0) {
          const method =
            payment_method || getSetting(db, "default_payment_method", "cash");
          const payDate = issue_date || new Date().toISOString().split("T")[0];
          const payResult = db.run(
            "INSERT INTO payments (invoice_id, amount, payment_date, method, reference, notes) VALUES (?, ?, ?, ?, '', '')",
            [newInvoiceId, total, payDate, method],
          );

          postLedgerEntry(db, {
            direction: CASH_DIRECTION.IN,
            scope: CASH_SCOPE.BUSINESS,
            amount: total,
            txnDate: payDate,
            method,
            sourceType: CASH_SOURCE_TYPE.INVOICE_PAYMENT,
            sourceId: payResult.lastInsertRowid,
            description: `Payment for invoice ${invoice_number}`,
          });
        }

        db.run("UPDATE invoice_sequence SET last_number = ? WHERE year = ?", [
          nextNum,
          year,
        ]);
        return newInvoiceId;
      })();

      const created = db.get(
        "SELECT invoice_number FROM invoices WHERE id = ?",
        [invoiceId],
      );
      return {
        success: true,
        data: { id: invoiceId, invoice_number: created.invoice_number },
      };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.INVOICES.UPDATE,
    safe((event, token, id, data) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const invoiceExists = db.get("SELECT * FROM invoices WHERE id = ?", [id]);
      if (!invoiceExists)
        return {
          success: false,
          error: { code: "NOT_FOUND", message: "Invoice not found" },
        };

      // Every field falls back to the invoice's current value when omitted,
      // so partial updates (e.g. just linking a project) can't silently
      // zero out status/dates/discount/tax the caller didn't intend to
      // touch. The full edit form already sends every field, so its
      // behavior is unchanged; callers that only want to change one thing
      // (like linking a project) no longer have to resend everything.
      const status = data.status !== undefined ? data.status : invoiceExists.status;
      const issue_date = data.issue_date !== undefined ? data.issue_date : invoiceExists.issue_date;
      const due_date = data.due_date !== undefined ? data.due_date : invoiceExists.due_date;
      const discount_percent = data.discount_percent !== undefined ? data.discount_percent : invoiceExists.discount_percent;
      const tax_percent = data.tax_percent !== undefined ? data.tax_percent : invoiceExists.tax_percent;
      const notes = data.notes !== undefined ? data.notes : invoiceExists.notes;
      const { items, project_id } = data;

      // project_id is optional on this endpoint — omitting it (the common
      // case, e.g. editing line items) must not silently unlink an existing
      // project. Pass project_id: null explicitly to unlink.
      const resolvedProjectId = project_id !== undefined ? project_id : invoiceExists.project_id;
      if (resolvedProjectId) {
        const project = db.get("SELECT id FROM projects WHERE id = ?", [resolvedProjectId]);
        if (!project)
          return {
            success: false,
            error: { code: "VALIDATION_ERROR", message: "Project not found" },
          };
      }

      db.transaction(() => {
        const currentItems = db.all(
          "SELECT * FROM invoice_items WHERE invoice_id = ?",
          [id],
        );

        // Only restore stock if items are being replaced.
        if (items) {
          for (const oldItem of currentItems) {
            if (oldItem.variant_id) {
              recordStockMovement(db, {
                variantId: oldItem.variant_id,
                changeQty: oldItem.quantity,
                reason: STOCK_MOVEMENT_REASON.ADJUSTMENT,
                referenceType: "invoice_item",
                referenceId: oldItem.id,
                notes: `Invoice #${id} items replaced — stock restored`,
              });
            }
          }
        }

        // Use the new items if provided, otherwise fall back to existing items for total calc.
        const baseItems = items || currentItems;
        const { subtotal, discountAmount, taxAmount, total } = calculateTotals(
          baseItems,
          discount_percent,
          tax_percent,
        );

        db.run(
          `UPDATE invoices SET status = ?, issue_date = ?, due_date = ?, subtotal = ?,
         discount_percent = ?, discount_amount = ?, tax_percent = ?, tax_amount = ?,
         total = ?, notes = ?, project_id = ? WHERE id = ?`,
          [
            status,
            issue_date,
            due_date,
            subtotal,
            discount_percent || 0,
            discountAmount,
            tax_percent || 0,
            taxAmount,
            total,
            notes || "",
            resolvedProjectId || null,
            id,
          ],
        );

        if (items) {
          db.run("DELETE FROM invoice_items WHERE invoice_id = ?", [id]);
          insertInvoiceItems(db, id, items);
        }
      })();

      return {
        success: true,
        data: db.get("SELECT * FROM invoices WHERE id = ?", [id]),
      };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.INVOICES.DELETE,
    safe((event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      db.transaction(() => {
        const items = db.all(
          "SELECT * FROM invoice_items WHERE invoice_id = ?",
          [id],
        );
        for (const item of items) {
          if (item.variant_id) {
            recordStockMovement(db, {
              variantId: item.variant_id,
              changeQty: item.quantity,
              reason: STOCK_MOVEMENT_REASON.ADJUSTMENT,
              referenceType: "invoice_item",
              referenceId: item.id,
              notes: `Invoice #${id} deleted — stock restored`,
            });
          }
        }
        db.run("DELETE FROM invoice_items WHERE invoice_id = ?", [id]);

        // Reverse each payment's ledger entry before the payments themselves
        // go away, so cash_transactions never outlives the record it traces
        // back to.
        const payments = db.all(
          "SELECT id FROM payments WHERE invoice_id = ?",
          [id],
        );
        for (const payment of payments) {
          reverseLedgerEntry(db, {
            sourceType: CASH_SOURCE_TYPE.INVOICE_PAYMENT,
            sourceId: payment.id,
          });
        }
        db.run("DELETE FROM payments WHERE invoice_id = ?", [id]);
        db.run("DELETE FROM invoices WHERE id = ?", [id]);
      })();

      return { success: true };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.INVOICES.NEXT_NUMBER,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const year = new Date().getFullYear();
      let seq = db.get(
        "SELECT last_number FROM invoice_sequence WHERE year = ?",
        [year],
      );
      if (!seq) seq = { last_number: 0 };
      const prefix = getSetting(db, "invoice_prefix", "INV");
      return {
        success: true,
        data: `${prefix}-${year}-${String(seq.last_number + 1).padStart(4, "0")}`,
      };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.INVOICES.GENERATE_PDF,
    safe(async (event, token, id) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      // Join users on the session's userId — avoids a cartesian join if
      // multiple user rows ever exist.
      const invoice = db.get(
        `SELECT i.*, c.name as client_name, c.email as client_email, c.phone as client_phone,
       c.address_line1 as client_address_line1, c.address_line2 as client_address_line2,
       c.city as client_city, c.state as client_state, c.postal_code as client_postal_code, c.country as client_country,
       u.company_name, u.company_address, u.company_phone, u.company_email, u.logo_path
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       JOIN users u ON u.id = ?
       WHERE i.id = ?`,
        [auth.userId, id],
      );
      if (!invoice)
        return {
          success: false,
          error: { code: "NOT_FOUND", message: "Invoice not found" },
        };

      const items = db.all(INVOICE_ITEMS_SELECT, [id]);
      const payments = db.all(
        "SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC",
        [id],
      );
      const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
      const currencySymbol = getSetting(db, "currency_symbol", undefined);

      return generateInvoicePdf({
        ...invoice,
        items,
        payments,
        totalPaid,
        currencySymbol,
      });
    }),
  );
}
