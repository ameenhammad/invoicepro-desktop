import log from "electron-log";
import { CASH_SOURCE_TYPE } from "../shared/constants.js";

// Versioned, tracked migrations — distinct from Database.runMigrations()
// (which patches missing columns onto already-existing tables on every
// boot). This is for one-time structural/data changes that must run at
// most once, ever, and be auditable — starting with the cash ledger and
// its historical backfill.
//
// Each migration's `up(db)` receives the raw better-sqlite3 connection and
// runs inside its own transaction; success is recorded in schema_migrations
// so it's never re-applied. The unique index created in version 1 is a
// second, independent guard against duplicate ledger rows even if a
// migration were somehow re-run.
export const MIGRATIONS = [
  {
    version: 1,
    name: "cash_transactions_ledger",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS cash_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          direction TEXT NOT NULL CHECK (direction IN ('in','out')),
          scope TEXT NOT NULL CHECK (scope IN ('business','personal')),
          amount REAL NOT NULL CHECK (amount > 0),
          txn_date DATE NOT NULL,
          accounting_month TEXT NOT NULL,
          method TEXT,
          source_type TEXT NOT NULL,
          source_id INTEGER NOT NULL,
          description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- The hard guard against double-counting: at most one ledger row per
        -- settlement record, regardless of source (invoice payment today,
        -- expense/purchase payments later).
        CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_transactions_source
          ON cash_transactions(source_type, source_id);

        CREATE INDEX IF NOT EXISTS idx_cash_transactions_date ON cash_transactions(txn_date);
        CREATE INDEX IF NOT EXISTS idx_cash_transactions_month ON cash_transactions(accounting_month);
        CREATE INDEX IF NOT EXISTS idx_cash_transactions_scope ON cash_transactions(scope, direction);
      `);
    },
  },
  {
    version: 2,
    name: "backfill_invoice_payments_to_ledger",
    up(db) {
      // Every existing payments row becomes exactly one ledger entry.
      // INSERT OR IGNORE is belt-and-suspenders with the unique index above:
      // this migration is tracked to run once, but even a second run (e.g.
      // a bug, or someone manually clearing schema_migrations) can't produce
      // duplicates.
      db.prepare(
        `INSERT OR IGNORE INTO cash_transactions
           (direction, scope, amount, txn_date, accounting_month, method, source_type, source_id, description, created_at)
         SELECT
           'in', 'business', p.amount, p.payment_date,
           substr(p.payment_date, 1, 7),
           p.method, ?, p.id,
           'Payment for invoice ' || i.invoice_number,
           p.created_at
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id`,
      ).run(CASH_SOURCE_TYPE.INVOICE_PAYMENT);
    },
  },
  {
    version: 3,
    name: "expenses",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS expenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          amount REAL NOT NULL CHECK (amount > 0),
          category TEXT NOT NULL,
          expense_date DATE NOT NULL,
          accounting_month TEXT NOT NULL,
          method TEXT,
          description TEXT,
          scope TEXT NOT NULL CHECK (scope IN ('business','personal')) DEFAULT 'business',
          -- Reserved for the future Projects phase. No FK yet — that table
          -- doesn't exist — just a plain nullable column so project-linked
          -- expenses don't need a schema change to arrive later.
          project_id INTEGER,
          status TEXT NOT NULL CHECK (status IN ('unpaid','paid')) DEFAULT 'paid',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
        CREATE INDEX IF NOT EXISTS idx_expenses_month ON expenses(accounting_month);
        CREATE INDEX IF NOT EXISTS idx_expenses_scope ON expenses(scope, status);
        CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
      `);
    },
  },
  {
    version: 4,
    name: "projects",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_number TEXT UNIQUE NOT NULL,
          customer_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
          name TEXT NOT NULL,
          project_type TEXT NOT NULL DEFAULT 'Other',
          description TEXT,
          start_date DATE,
          expected_completion_date DATE,
          status TEXT NOT NULL DEFAULT 'quotation'
            CHECK (status IN ('quotation','confirmed','in_progress','completed','delivered','cancelled')),
          quoted_amount REAL NOT NULL DEFAULT 0,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_projects_customer ON projects(customer_id);
        CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

        -- Mirrors invoice_sequence exactly, for PRJ-YYYY-NNNN numbering.
        CREATE TABLE IF NOT EXISTS project_sequence (
          year INTEGER PRIMARY KEY,
          last_number INTEGER DEFAULT 0
        );

        -- expenses.project_id already exists (added, unused, in the
        -- expenses migration) — now that projects exist, it gets queried.
        CREATE INDEX IF NOT EXISTS idx_expenses_project_id ON expenses(project_id);
      `);

      // invoices.project_id — nullable, no hard FK (SQLite can't add one to
      // an existing table without a full rebuild); validated at the IPC
      // layer instead, same approach already used for expenses.project_id.
      // Project revenue is computed by joining cash_transactions through
      // payments through invoices, never by adding a column to the ledger
      // itself — the ledger's shape doesn't change in this migration.
      const invoiceColumns = db.prepare("PRAGMA table_info(invoices)").all().map((c) => c.name);
      if (!invoiceColumns.includes("project_id")) {
        db.exec("ALTER TABLE invoices ADD COLUMN project_id INTEGER");
      }
      db.exec("CREATE INDEX IF NOT EXISTS idx_invoices_project_id ON invoices(project_id)");
    },
  },
  {
    version: 5,
    name: "workshop_services_and_inventory",
    up(db) {
      // services.unit — "8 sheets", "120 running ft", etc. Existing rows
      // default to 'Piece'; editable per-service afterward if that's wrong.
      const serviceColumns = db.prepare("PRAGMA table_info(services)").all().map((c) => c.name);
      if (!serviceColumns.includes("unit")) {
        db.exec("ALTER TABLE services ADD COLUMN unit TEXT NOT NULL DEFAULT 'Piece'");
      }

      // product_variants gain a cost basis and a reserved (unenforced,
      // no table yet) supplier reference — same pattern as
      // expenses.project_id before the projects table existed.
      const variantColumns = db.prepare("PRAGMA table_info(product_variants)").all().map((c) => c.name);
      if (!variantColumns.includes("cost_price")) {
        db.exec("ALTER TABLE product_variants ADD COLUMN cost_price REAL NOT NULL DEFAULT 0");
      }
      if (!variantColumns.includes("supplier_id")) {
        db.exec("ALTER TABLE product_variants ADD COLUMN supplier_id INTEGER");
      }

      db.exec(`
        CREATE TABLE IF NOT EXISTS stock_movements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          variant_id INTEGER NOT NULL REFERENCES product_variants(id),
          change_qty INTEGER NOT NULL,
          quantity_before INTEGER NOT NULL,
          quantity_after INTEGER NOT NULL,
          reason TEXT NOT NULL CHECK (reason IN ('stock_in','stock_out','sale','adjustment')),
          reference_type TEXT,
          reference_id INTEGER,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_stock_movements_variant ON stock_movements(variant_id);
        CREATE INDEX IF NOT EXISTS idx_stock_movements_reason ON stock_movements(reason);
        CREATE INDEX IF NOT EXISTS idx_stock_movements_reference ON stock_movements(reference_type, reference_id);
      `);

      // Opening-balance backfill: every variant that already carries stock
      // predates movement tracking, so without this its history could never
      // fully explain its current quantity. One synthetic row per variant
      // makes SUM(change_qty) == quantity hold from day one, for every
      // variant, not just ones created after this migration.
      const variantsWithStock = db.prepare("SELECT id, quantity FROM product_variants WHERE quantity != 0").all();
      const insertOpeningBalance = db.prepare(
        `INSERT INTO stock_movements (variant_id, change_qty, quantity_before, quantity_after, reason, reference_type, notes)
         VALUES (?, ?, 0, ?, 'adjustment', 'migration', 'Opening balance — recorded when stock movement tracking was introduced')`,
      );
      for (const v of variantsWithStock) {
        insertOpeningBalance.run(v.id, v.quantity, v.quantity);
      }
    },
  },
  {
    version: 6,
    name: "suppliers_purchases_workers",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS suppliers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          phone TEXT,
          address TEXT,
          notes TEXT,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(is_active);

        CREATE TABLE IF NOT EXISTS workers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          phone TEXT,
          role TEXT,
          wage_type TEXT NOT NULL DEFAULT 'daily'
            CHECK (wage_type IN ('daily','weekly','monthly','per_job','other')),
          default_rate REAL NOT NULL DEFAULT 0,
          is_active INTEGER DEFAULT 1,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_workers_active ON workers(is_active);

        -- Mirrors invoice_sequence/project_sequence exactly, for PUR-YYYY-NNNN numbering.
        CREATE TABLE IF NOT EXISTS purchase_sequence (
          year INTEGER PRIMARY KEY,
          last_number INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS purchases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          purchase_number TEXT UNIQUE NOT NULL,
          supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
          -- Reserved link so a purchase can be earmarked for one project's
          -- cost — no FK (invoices.project_id/expenses.project_id follow the
          -- same unenforced-reference convention).
          project_id INTEGER,
          purchase_date DATE NOT NULL,
          accounting_month TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid')),
          subtotal REAL NOT NULL DEFAULT 0,
          total REAL NOT NULL DEFAULT 0,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
        CREATE INDEX IF NOT EXISTS idx_purchases_project ON purchases(project_id);
        CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status);
        CREATE INDEX IF NOT EXISTS idx_purchases_month ON purchases(accounting_month);

        -- Always variant-based (a purchase receipts real stock) — unlike
        -- invoice_items, no free-text/service option.
        CREATE TABLE IF NOT EXISTS purchase_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
          variant_id INTEGER NOT NULL REFERENCES product_variants(id),
          description TEXT,
          quantity REAL NOT NULL,
          unit_cost REAL NOT NULL DEFAULT 0,
          line_total REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
        CREATE INDEX IF NOT EXISTS idx_purchase_items_variant ON purchase_items(variant_id);

        -- Mirrors 'payments' exactly — the settlement side of a purchase.
        CREATE TABLE IF NOT EXISTS purchase_payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
          amount REAL NOT NULL,
          payment_date DATE,
          method TEXT,
          reference TEXT,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_purchase_payments_purchase ON purchase_payments(purchase_id);
      `);

      // product_variants.supplier_id already exists (reserved, unused,
      // added in the workshop/inventory migration) — now that suppliers
      // exist, it gets validated and used.

      // expenses.worker_id — wage *payments* reuse the expenses table
      // wholesale (category 'Worker Wages', worker_id set) instead of a
      // second ledger-writing path. Same reserved-then-used pattern as
      // expenses.project_id before Projects existed.
      const expenseColumns = db.prepare("PRAGMA table_info(expenses)").all().map((c) => c.name);
      if (!expenseColumns.includes("worker_id")) {
        db.exec("ALTER TABLE expenses ADD COLUMN worker_id INTEGER");
      }
      db.exec("CREATE INDEX IF NOT EXISTS idx_expenses_worker_id ON expenses(worker_id)");
    },
  },
];

export function runVersionedMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((r) => r.version),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;

    log.info(`Applying migration ${migration.version}: ${migration.name}`);
    db.transaction(() => {
      migration.up(db);
      db.prepare(
        "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
      ).run(migration.version, migration.name);
    })();
  }
}
