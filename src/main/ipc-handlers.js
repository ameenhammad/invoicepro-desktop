const { ipcMain } = require("electron");
const log = require("electron-log");
const {
  login,
  logout,
  validateSession,
  getSettings,
  updateSettings,
} = require("./auth");
const { generateInvoicePdf } = require("./pdf-generator");
const { IPC_CHANNELS, INVOICE_STATUS } = require("../shared/constants");

function setupIpcHandlers(db, sessions) {
  // ============ AUTH ============
  ipcMain.handle(IPC_CHANNELS.AUTH.LOGIN, (event, username, password) => {
    return login(db, username, password);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH.LOGOUT, (event, token) => {
    return logout(token);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH.CHECK, (event, token) => {
    return validateSession(token);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH.GET_SETTINGS, (event, token) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };
    return getSettings(db, session.userId);
  });

  ipcMain.handle(
    IPC_CHANNELS.AUTH.UPDATE_SETTINGS,
    (event, token, settings) => {
      const session = validateSession(token);
      if (!session.valid)
        return {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Not authenticated" },
        };
      return updateSettings(db, session.userId, settings);
    },
  );

  // ============ PRODUCTS ============
  ipcMain.handle(IPC_CHANNELS.PRODUCTS.GET_ALL, (event, token, search) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

    let sql = "SELECT * FROM products WHERE is_active = 1";
    const params = [];
    if (search) {
      sql += " AND (name LIKE ? OR description LIKE ? OR sku LIKE ?)";
      const term = `%${search}%`;
      params.push(term, term, term);
    }
    sql += " ORDER BY name ASC";

    return { success: true, data: db.all(sql, params) };
  });

  ipcMain.handle(IPC_CHANNELS.PRODUCTS.GET, (event, token, id) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

    const product = db.get("SELECT * FROM products WHERE id = ?", [id]);
    if (!product)
      return {
        success: false,
        error: { code: "NOT_FOUND", message: "Product not found" },
      };
    return { success: true, data: product };
  });

  ipcMain.handle(IPC_CHANNELS.PRODUCTS.CREATE, (event, token, data) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

    const { name, description, price, unit, sku, custom_fields } = data;
    if (!name)
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Product name is required",
        },
      };

    const result = db.run(
      "INSERT INTO products (name, description, price, unit, sku, custom_fields) VALUES (?, ?, ?, ?, ?, ?)",
      [
        name,
        description || "",
        price || 0,
        unit || "unit",
        sku || "",
        custom_fields ? JSON.stringify(custom_fields) : null,
      ],
    );

    return { success: true, data: { id: result.lastInsertRowid } };
  });

  ipcMain.handle(IPC_CHANNELS.PRODUCTS.UPDATE, (event, token, id, data) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

    const { name, description, price, unit, sku, is_active, custom_fields } =
      data;
    db.run(
      "UPDATE products SET name = ?, description = ?, price = ?, unit = ?, sku = ?, is_active = ?, custom_fields = ? WHERE id = ?",
      [
        name,
        description || "",
        price || 0,
        unit || "unit",
        sku || "",
        is_active ?? 1,
        custom_fields ? JSON.stringify(custom_fields) : null,
        id,
      ],
    );

    return {
      success: true,
      data: db.get("SELECT * FROM products WHERE id = ?", [id]),
    };
  });

  ipcMain.handle(IPC_CHANNELS.PRODUCTS.DELETE, (event, token, id) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

    // Soft delete
    db.run("UPDATE products SET is_active = 0 WHERE id = ?", [id]);
    return { success: true };
  });

  // ============ CLIENTS ============
  ipcMain.handle(IPC_CHANNELS.CLIENTS.GET_ALL, (event, token, search) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

    let sql = "SELECT * FROM clients WHERE is_active = 1";
    const params = [];
    if (search) {
      sql += " AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)";
      const term = `%${search}%`;
      params.push(term, term, term);
    }
    sql += " ORDER BY name ASC";

    return { success: true, data: db.all(sql, params) };
  });

  ipcMain.handle(IPC_CHANNELS.CLIENTS.GET, (event, token, id) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

    const client = db.get("SELECT * FROM clients WHERE id = ?", [id]);
    if (!client)
      return {
        success: false,
        error: { code: "NOT_FOUND", message: "Client not found" },
      };
    return { success: true, data: client };
  });

  ipcMain.handle(IPC_CHANNELS.CLIENTS.CREATE, (event, token, data) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

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
      custom_fields,
    } = data;
    if (!name)
      return {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Client name is required" },
      };

    const result = db.run(
      `INSERT INTO clients (name, email, phone, address_line1, address_line2, city, state, postal_code, country, custom_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        email || "",
        phone || "",
        address_line1 || "",
        address_line2 || "",
        city || "",
        state || "",
        postal_code || "",
        country || "United States",
        custom_fields ? JSON.stringify(custom_fields) : null,
      ],
    );

    return { success: true, data: { id: result.lastInsertRowid } };
  });

  ipcMain.handle(IPC_CHANNELS.CLIENTS.UPDATE, (event, token, id, data) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

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
      custom_fields,
    } = data;
    db.run(
      `UPDATE clients SET name = ?, email = ?, phone = ?, address_line1 = ?, address_line2 = ?, city = ?, state = ?, postal_code = ?, country = ?, is_active = ?, custom_fields = ? WHERE id = ?`,
      [
        name,
        email || "",
        phone || "",
        address_line1 || "",
        address_line2 || "",
        city || "",
        state || "",
        postal_code || "",
        country || "United States",
        is_active ?? 1,
        custom_fields ? JSON.stringify(custom_fields) : null,
        id,
      ],
    );

    return {
      success: true,
      data: db.get("SELECT * FROM clients WHERE id = ?", [id]),
    };
  });

  ipcMain.handle(IPC_CHANNELS.CLIENTS.DELETE, (event, token, id) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

    // Check if client has invoices
    const invoiceCount = db.get(
      "SELECT COUNT(*) as count FROM invoices WHERE client_id = ?",
      [id],
    ).count;
    if (invoiceCount > 0) {
      return {
        success: false,
        error: {
          code: "HAS_INVOICES",
          message: "Cannot delete client with existing invoices",
        },
      };
    }

    // Soft delete
    db.run("UPDATE clients SET is_active = 0 WHERE id = ?", [id]);
    return { success: true };
  });

  // ============ INVOICES ============
  ipcMain.handle(IPC_CHANNELS.INVOICES.GET_ALL, (event, token, filters) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

    let sql = `SELECT i.*, c.name as client_name,
               (SELECT SUM(amount) FROM payments WHERE invoice_id = i.id) as paid_amount
               FROM invoices i
               JOIN clients c ON i.client_id = c.id WHERE 1=1`;
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
  });

  ipcMain.handle(IPC_CHANNELS.INVOICES.GET, (event, token, id) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

    const invoice = db.get(
      `SELECT i.*, c.name as client_name, c.email as client_email, c.phone as client_phone,
                            c.address_line1 as client_address_line1, c.address_line2 as client_address_line2,
                            c.city as client_city, c.state as client_state, c.postal_code as client_postal_code, c.country as client_country
                            FROM invoices i JOIN clients c ON i.client_id = c.id WHERE i.id = ?`,
      [id],
    );
    if (!invoice)
      return {
        success: false,
        error: { code: "NOT_FOUND", message: "Invoice not found" },
      };

    const items = db.all("SELECT * FROM invoice_items WHERE invoice_id = ?", [
      id,
    ]);
    const payments = db.all(
      "SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC",
      [id],
    );

    return { success: true, data: { ...invoice, items, payments } };
  });

  ipcMain.handle(IPC_CHANNELS.INVOICES.CREATE, (event, token, data) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

    const {
      client_id,
      status,
      issue_date,
      due_date,
      discount_percent,
      tax_percent,
      notes,
      items,
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

    // Generate invoice number
    const year = new Date().getFullYear();
    let seq = db.get(
      "SELECT last_number FROM invoice_sequence WHERE year = ?",
      [year],
    );
    if (!seq) {
      db.run("INSERT INTO invoice_sequence (year, last_number) VALUES (?, 0)", [
        year,
      ]);
      seq = { last_number: 0 };
    }
    const nextNum = seq.last_number + 1;
    const invoice_number = `INV-${year}-${String(nextNum).padStart(4, "0")}`;

    // Calculate totals
    const subtotal = items.reduce(
      (sum, item) => sum + (item.line_total || 0),
      0,
    );
    const discountAmount = subtotal * ((discount_percent || 0) / 100);
    const afterDiscount = subtotal - discountAmount;
    const taxAmount = afterDiscount * ((tax_percent || 0) / 100);
    const total = afterDiscount + taxAmount;

    const insertInvoice = db.transaction(() => {
      const result = db.run(
        `INSERT INTO invoices (invoice_number, client_id, status, issue_date, due_date, subtotal, discount_percent, discount_amount, tax_percent, tax_amount, total, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoice_number,
          client_id,
          status || INVOICE_STATUS.PENDING,
          issue_date,
          due_date,
          subtotal,
          discount_percent || 0,
          discountAmount,
          tax_percent || 0,
          taxAmount,
          total,
          notes || "",
        ],
      );
      const invoiceId = result.lastInsertRowid;

      for (const item of items) {
        db.run(
          "INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit_price, tax_percent, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            invoiceId,
            item.product_id || null,
            item.description,
            item.quantity,
            item.unit_price,
            item.tax_percent || 0,
            item.line_total,
          ],
        );
      }

      // Update sequence
      db.run("UPDATE invoice_sequence SET last_number = ? WHERE year = ?", [
        nextNum,
        year,
      ]);

      return invoiceId;
    });

    const invoiceId = insertInvoice();
    return { success: true, data: { id: invoiceId, invoice_number } };
  });

  ipcMain.handle(IPC_CHANNELS.INVOICES.UPDATE, (event, token, id, data) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

    const { status, due_date, discount_percent, tax_percent, notes, items } =
      data;

    const updateInvoice = db.transaction(() => {
      // Get current items
      const currentItems = db.all(
        "SELECT * FROM invoice_items WHERE invoice_id = ?",
        [id],
      );
      const subtotal = items
        ? items.reduce((sum, item) => sum + (item.line_total || 0), 0)
        : currentItems.reduce((sum, item) => sum + (item.line_total || 0), 0);
      const discountAmount = subtotal * ((discount_percent || 0) / 100);
      const afterDiscount = subtotal - discountAmount;
      const taxAmount = afterDiscount * ((tax_percent || 0) / 100);
      const total = afterDiscount + taxAmount;

      db.run(
        `UPDATE invoices SET status = ?, due_date = ?, discount_percent = ?, discount_amount = ?, tax_percent = ?, tax_amount = ?, total = ?, notes = ? WHERE id = ?`,
        [
          status,
          due_date,
          discount_percent || 0,
          discountAmount,
          tax_percent || 0,
          taxAmount,
          total,
          notes || "",
          id,
        ],
      );

      if (items) {
        db.run("DELETE FROM invoice_items WHERE invoice_id = ?", [id]);
        for (const item of items) {
          db.run(
            "INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit_price, tax_percent, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              id,
              item.product_id || null,
              item.description,
              item.quantity,
              item.unit_price,
              item.tax_percent || 0,
              item.line_total,
            ],
          );
        }
      }
    });

    updateInvoice();
    return {
      success: true,
      data: db.get("SELECT * FROM invoices WHERE id = ?", [id]),
    };
  });

  ipcMain.handle(IPC_CHANNELS.INVOICES.DELETE, (event, token, id) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

    db.run("DELETE FROM invoices WHERE id = ?", [id]);
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.INVOICES.NEXT_NUMBER, (event, token) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

    const year = new Date().getFullYear();
    let seq = db.get(
      "SELECT last_number FROM invoice_sequence WHERE year = ?",
      [year],
    );
    if (!seq) {
      db.run("INSERT INTO invoice_sequence (year, last_number) VALUES (?, 0)", [
        year,
      ]);
      seq = { last_number: 0 };
    }
    return {
      success: true,
      data: `INV-${year}-${String(seq.last_number + 1).padStart(4, "0")}`,
    };
  });

  ipcMain.handle(
    IPC_CHANNELS.INVOICES.GENERATE_PDF,
    async (event, token, id) => {
      const session = validateSession(token);
      if (!session.valid)
        return {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Not authenticated" },
        };

      const invoice = db.get(
        `SELECT i.*, c.name as client_name, c.email as client_email, c.phone as client_phone,
                            c.address_line1 as client_address_line1, c.address_line2 as client_address_line2,
                            c.city as client_city, c.state as client_state, c.postal_code as client_postal_code, c.country as client_country,
                            u.company_name, u.company_address, u.company_phone, u.company_email
                            FROM invoices i
                            JOIN clients c ON i.client_id = c.id
                            JOIN users u ON 1=1 WHERE i.id = ?`,
        [id],
      );
      if (!invoice)
        return {
          success: false,
          error: { code: "NOT_FOUND", message: "Invoice not found" },
        };

      const items = db.all("SELECT * FROM invoice_items WHERE invoice_id = ?", [
        id,
      ]);
      const payments = db.all(
        "SELECT SUM(amount) as total_paid FROM payments WHERE invoice_id = ?",
        [id],
      );

      return generateInvoicePdf({
        ...invoice,
        items,
        totalPaid: payments.total_paid || 0,
      });
    },
  );

  // ============ PAYMENTS ============
  ipcMain.handle(
    IPC_CHANNELS.PAYMENTS.GET_BY_INVOICE,
    (event, token, invoiceId) => {
      const session = validateSession(token);
      if (!session.valid)
        return {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Not authenticated" },
        };

      const payments = db.all(
        "SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC",
        [invoiceId],
      );
      return { success: true, data: payments };
    },
  );

  ipcMain.handle(IPC_CHANNELS.PAYMENTS.CREATE, (event, token, data) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

    const { invoice_id, amount, payment_date, method, reference, notes } = data;
    if (!invoice_id)
      return {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Invoice is required" },
      };
    if (!amount || amount <= 0)
      return {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Amount must be positive" },
      };

    const result = db.run(
      "INSERT INTO payments (invoice_id, amount, payment_date, method, reference, notes) VALUES (?, ?, ?, ?, ?, ?)",
      [
        invoice_id,
        amount,
        payment_date || new Date().toISOString().split("T")[0],
        method || "cash",
        reference || "",
        notes || "",
      ],
    );

    // Update invoice status based on payments
    const invoice = db.get("SELECT * FROM invoices WHERE id = ?", [invoice_id]);
    const totalPaid = db.get(
      "SELECT SUM(amount) as total FROM payments WHERE invoice_id = ?",
      [invoice_id],
    ).total;

    let newStatus = INVOICE_STATUS.PENDING;
    if (totalPaid >= invoice.total) {
      newStatus = INVOICE_STATUS.PAID;
    } else if (totalPaid > 0) {
      newStatus = INVOICE_STATUS.PARTIAL;
    }

    db.run("UPDATE invoices SET status = ? WHERE id = ?", [
      newStatus,
      invoice_id,
    ]);

    return { success: true, data: { id: result.lastInsertRowid } };
  });

  ipcMain.handle(IPC_CHANNELS.PAYMENTS.DELETE, (event, token, id) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

    const payment = db.get("SELECT * FROM payments WHERE id = ?", [id]);
    if (!payment)
      return {
        success: false,
        error: { code: "NOT_FOUND", message: "Payment not found" },
      };

    db.run("DELETE FROM payments WHERE id = ?", [id]);

    // Update invoice status
    const invoice = db.get("SELECT * FROM invoices WHERE id = ?", [
      payment.invoice_id,
    ]);
    const totalPaid =
      db.get("SELECT SUM(amount) as total FROM payments WHERE invoice_id = ?", [
        payment.invoice_id,
      ]).total || 0;

    let newStatus = INVOICE_STATUS.PENDING;
    if (totalPaid >= invoice.total) {
      newStatus = INVOICE_STATUS.PAID;
    } else if (totalPaid > 0) {
      newStatus = INVOICE_STATUS.PARTIAL;
    }

    db.run("UPDATE invoices SET status = ? WHERE id = ?", [
      newStatus,
      payment.invoice_id,
    ]);

    return { success: true };
  });

  // ============ REPORTS ============
  ipcMain.handle(IPC_CHANNELS.REPORTS.SUMMARY, (event, token) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

    const totalRevenue = db.get(
      "SELECT COALESCE(SUM(total), 0) as value FROM invoices WHERE status = ?",
      [INVOICE_STATUS.PAID],
    ).value;
    const pendingAmount = db.get(
      "SELECT COALESCE(SUM(total), 0) as value FROM invoices WHERE status IN (?, ?)",
      [INVOICE_STATUS.PENDING, INVOICE_STATUS.PARTIAL],
    ).value;
    const totalInvoices = db.get(
      "SELECT COUNT(*) as value FROM invoices",
    ).value;
    const paidInvoices = db.get(
      "SELECT COUNT(*) as value FROM invoices WHERE status = ?",
      [INVOICE_STATUS.PAID],
    ).value;
    const pendingInvoices = db.get(
      "SELECT COUNT(*) as value FROM invoices WHERE status IN (?, ?)",
      [INVOICE_STATUS.PENDING, INVOICE_STATUS.PARTIAL],
    ).value;
    const totalClients = db.get(
      "SELECT COUNT(*) as value FROM clients WHERE is_active = 1",
    ).value;
    const totalProducts = db.get(
      "SELECT COUNT(*) as value FROM products WHERE is_active = 1",
    ).value;

    return {
      success: true,
      data: {
        totalRevenue,
        pendingAmount,
        totalInvoices,
        paidInvoices,
        pendingInvoices,
        totalClients,
        totalProducts,
      },
    };
  });

  ipcMain.handle(IPC_CHANNELS.REPORTS.REVENUE, (event, token, filters) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

    let sql = `SELECT i.*, c.name as client_name FROM invoices i JOIN clients c ON i.client_id = c.id WHERE i.status = ?`;
    const params = [INVOICE_STATUS.PAID];

    if (filters) {
      if (filters.fromDate) {
        sql += " AND i.issue_date >= ?";
        params.push(filters.fromDate);
      }
      if (filters.toDate) {
        sql += " AND i.issue_date <= ?";
        params.push(filters.toDate);
      }
      if (filters.clientId) {
        sql += " AND i.client_id = ?";
        params.push(filters.clientId);
      }
    }

    sql += " ORDER BY i.issue_date DESC";

    const invoices = db.all(sql, params);
    const total = invoices.reduce((sum, inv) => sum + inv.total, 0);

    return { success: true, data: { invoices, total } };
  });

  ipcMain.handle(IPC_CHANNELS.REPORTS.PENDING, (event, token) => {
    const session = validateSession(token);
    if (!session.valid)
      return {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      };

    const invoices = db.all(
      `SELECT i.*, c.name as client_name, (SELECT SUM(amount) FROM payments WHERE invoice_id = i.id) as paid_amount
       FROM invoices i JOIN clients c ON i.client_id = c.id
       WHERE i.status IN (?, ?) ORDER BY i.due_date ASC`,
      [INVOICE_STATUS.PENDING, INVOICE_STATUS.PARTIAL],
    );

    return { success: true, data: invoices };
  });

  log.info("IPC handlers registered");
}

module.exports = { setupIpcHandlers };
