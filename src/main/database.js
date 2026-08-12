import Database from "better-sqlite3";
import path from "path";
import { app } from "electron";
import bcrypt from "bcryptjs";
import log from "electron-log";
import { DEFAULT_ADMIN, DEFAULT_SERVICES, DEFAULT_APP_SETTINGS } from "../shared/constants.js";
import { runVersionedMigrations } from "./migrations.js";

class InvoiceDatabase {
  constructor() {
    // FIX: Use userData path so it works correctly in packaged Electron apps
    const userDataPath = app.getPath("userData");
    const dbPath = path.join(userDataPath, "invoicepro.db");
    log.info("Opening database at:", dbPath);

    // FIX: Wrap DB open in try/catch for useful error reporting
    try {
      this.db = new Database(dbPath);
    } catch (err) {
      log.error("Failed to open database:", err);
      throw err;
    }

    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL"); // FIX: WAL mode improves concurrent read performance

    this.initTables();
    this.ensureAdmin();
    this.ensureAppSettings();
    this.ensureWalkInCustomer();
    this.ensureDefaultServices();
  }

  initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        company_name TEXT DEFAULT 'My Company',
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
        category TEXT DEFAULT 'Other',
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS product_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        size_name TEXT NOT NULL,
        sku TEXT,
        price REAL NOT NULL DEFAULT 0,
        quantity INTEGER NOT NULL DEFAULT 0,
        low_stock_threshold INTEGER DEFAULT 10,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL DEFAULT 0,
        is_active INTEGER DEFAULT 1,
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
        country TEXT DEFAULT 'Pakistan',
        is_active INTEGER DEFAULT 1,
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
        variant_id INTEGER,
        service_id INTEGER,
        description TEXT NOT NULL,
        variant_name TEXT,
        quantity REAL DEFAULT 1,
        unit_price REAL DEFAULT 0,
        tax_percent REAL DEFAULT 0,
        line_total REAL DEFAULT 0,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
        FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL,
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
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

      -- FIX: Add indexes for frequently queried foreign key and lookup columns
      CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id);
      CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_invoice_items_product_id ON invoice_items(product_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
      CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);
    `);

    this.runMigrations();
    runVersionedMigrations(this.db);

    log.info("Database tables initialized");
  }

  // CREATE TABLE IF NOT EXISTS never alters a table that already exists, so
  // databases created by older versions of the app are stuck without columns
  // added later. Add any missing columns (and their indexes) here.
  runMigrations() {
    const requiredColumns = {
      invoice_items: [
        { name: "variant_id", ddl: "INTEGER" },
        { name: "variant_name", ddl: "TEXT" },
        { name: "service_id", ddl: "INTEGER" },
      ],
      products: [{ name: "category", ddl: "TEXT DEFAULT 'Other'" }],
    };

    for (const [table, columns] of Object.entries(requiredColumns)) {
      const existing = new Set(
        this.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name),
      );
      for (const { name, ddl } of columns) {
        if (!existing.has(name)) {
          log.info(`Migrating: adding column ${table}.${name}`);
          this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
        }
      }
    }

    // Safe to (re-)create now that invoice_items.service_id is guaranteed to exist.
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_invoice_items_service_id ON invoice_items(service_id)",
    );
  }

  ensureAdmin() {
    const existingAdmin = this.db
      .prepare("SELECT id FROM users WHERE username = ?")
      .get(DEFAULT_ADMIN.USERNAME);

    if (!existingAdmin) {
      const hash = bcrypt.hashSync(DEFAULT_ADMIN.PASSWORD, 12);
      this.db
        .prepare(
          `INSERT INTO users (username, password_hash, company_name, company_address, company_phone, company_email)
           VALUES (?, ?, 'My Company', '', '', '')`,
        )
        .run(DEFAULT_ADMIN.USERNAME, hash);
      log.info("Default admin user created");
    }
  }

  // Seed app-wide workshop settings (only fills in keys that don't exist yet,
  // so it never overwrites a value the user has already configured).
  ensureAppSettings() {
    const insertIfMissing = this.db.prepare(
      "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
    );
    for (const [key, value] of Object.entries(DEFAULT_APP_SETTINGS)) {
      insertIfMissing.run(key, value);
    }
  }

  // A permanent client that new invoices default to, for fast walk-in
  // checkout. Created once; its id is remembered in settings so it can be
  // looked up even if renamed, and so CLIENTS.DELETE can refuse to remove it.
  ensureWalkInCustomer() {
    const existingId = this.db
      .prepare("SELECT value FROM settings WHERE key = 'default_walkin_client_id'")
      .get()?.value;
    if (existingId) {
      const stillExists = this.db
        .prepare("SELECT id FROM clients WHERE id = ?")
        .get(existingId);
      if (stillExists) return;
    }

    const result = this.db
      .prepare(
        `INSERT INTO clients (name, phone, address_line1, country)
         VALUES ('Walk-in Customer', '', '', 'Pakistan')`,
      )
      .run();
    this.db
      .prepare(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('default_walkin_client_id', ?)",
      )
      .run(String(result.lastInsertRowid));
    log.info("Walk-in Customer client created:", result.lastInsertRowid);
  }

  ensureDefaultServices() {
    const existing = this.db.prepare("SELECT id FROM services WHERE name = ?");
    const insert = this.db.prepare(
      "INSERT INTO services (name, description, price, unit) VALUES (?, ?, ?, ?)",
    );
    for (const svc of DEFAULT_SERVICES) {
      if (!existing.get(svc.name)) {
        insert.run(svc.name, svc.description, svc.price, svc.unit);
        log.info("Default service created:", svc.name);
      }
    }
  }

  // Helper methods
  run(sql, params = []) {
    return this.db.prepare(sql).run(...params);
  }

  get(sql, params = []) {
    return this.db.prepare(sql).get(...params);
  }

  all(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  // Mirrors better-sqlite3's native API: returns a callable that runs `fn`
  // inside a transaction when invoked. Every call site does db.transaction(fn)().
  transaction(fn) {
    return this.db.transaction(fn);
  }
}

export default InvoiceDatabase;
