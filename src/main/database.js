const Database = require("better-sqlite3");
const path = require("path");
const bcrypt = require("bcryptjs");
const log = require("electron-log");
const { DEFAULT_ADMIN } = require("../shared/constants");

class InvoiceDatabase {
  constructor() {
    const dbPath = path.join(__dirname, "../../data/invoicepro.db");
    log.info("Opening database at:", dbPath);

    this.db = new Database(dbPath);
    this.db.pragma("foreign_keys = ON");

    this.initTables();
    this.ensureAdmin();
  }

  initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        company_name TEXT DEFAULT 'InvoicePro',
        company_address TEXT,
        company_phone TEXT,
        company_email TEXT,
        logo_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL DEFAULT 0,
        unit TEXT DEFAULT 'unit',
        sku TEXT,
        is_active INTEGER DEFAULT 1,
        custom_fields TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        address_line1 TEXT,
        address_line2 TEXT,
        city TEXT,
        state TEXT,
        postal_code TEXT,
        country TEXT DEFAULT 'United States',
        is_active INTEGER DEFAULT 1,
        custom_fields TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_number TEXT UNIQUE NOT NULL,
        client_id INTEGER NOT NULL,
        status TEXT DEFAULT 'draft',
        issue_date DATE,
        due_date DATE,
        subtotal REAL DEFAULT 0,
        discount_percent REAL DEFAULT 0,
        discount_amount REAL DEFAULT 0,
        tax_percent REAL DEFAULT 0,
        tax_amount REAL DEFAULT 0,
        total REAL DEFAULT 0,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS invoice_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL,
        product_id INTEGER,
        description TEXT NOT NULL,
        quantity REAL DEFAULT 1,
        unit_price REAL DEFAULT 0,
        tax_percent REAL DEFAULT 0,
        line_total REAL DEFAULT 0,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        payment_date DATE,
        method TEXT,
        reference TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS invoice_sequence (
        year INTEGER PRIMARY KEY,
        last_number INTEGER DEFAULT 0
      );
    `);

    log.info("Database tables initialized");
  }

  ensureAdmin() {
    const existingAdmin = this.db
      .prepare("SELECT id FROM users WHERE username = ?")
      .get(DEFAULT_ADMIN.USERNAME);
    if (!existingAdmin) {
      const hash = bcrypt.hashSync(DEFAULT_ADMIN.PASSWORD, 12);
      this.db
        .prepare(
          `
        INSERT INTO users (username, password_hash, company_name, company_address, company_phone, company_email)
        VALUES (?, ?, 'My Business', '', '', '')
      `,
        )
        .run(DEFAULT_ADMIN.USERNAME, hash);
      log.info("Default admin user created");
    }
  }

  // Helper methods for each table
  run(sql, params = []) {
    return this.db.prepare(sql).run(...params);
  }

  get(sql, params = []) {
    return this.db.prepare(sql).get(...params);
  }

  all(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }
}

module.exports = InvoiceDatabase;
