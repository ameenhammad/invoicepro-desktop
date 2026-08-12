import { ipcMain, dialog, app } from "electron";
import path from "path";
import fs from "fs";
import log from "electron-log";
import RawDatabase from "better-sqlite3";
import { IPC_CHANNELS } from "../shared/constants.js";
import { requireAuth, safe } from "./ipc/helpers.js";

// A backup/restore file must at least look like an InvoicePro database
// before we trust it — this is the one line of defense between "user picks
// the wrong file" and a corrupted install.
const REQUIRED_TABLES = ["users", "clients", "invoices", "cash_transactions"];

function validateBackupFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { valid: false, reason: "File does not exist" };
  }

  let testDb;
  try {
    testDb = new RawDatabase(filePath, { readonly: true, fileMustExist: true });
    const integrity = testDb.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") {
      return { valid: false, reason: `SQLite integrity check failed: ${integrity}` };
    }

    const existingTables = new Set(
      testDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
    );
    const missing = REQUIRED_TABLES.filter((t) => !existingTables.has(t));
    if (missing.length > 0) {
      return { valid: false, reason: `Not an InvoicePro database — missing tables: ${missing.join(", ")}` };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, reason: `Not a valid SQLite database: ${err.message}` };
  } finally {
    if (testDb) testDb.close();
  }
}

// db is the app's InvoiceDatabase wrapper (db.db is the live better-sqlite3
// connection); getMainWindow gives dialogs a parent, mirroring file-ipc.js.
export function registerBackupHandlers(db, getMainWindow) {
  // Dialog steps stay unauthenticated (harmless — matches file-ipc.js's
  // dialog:save-file precedent); the actual data operations below require a
  // valid session.
  ipcMain.handle(IPC_CHANNELS.BACKUP.CHOOSE_DESTINATION, async () => {
    const win = getMainWindow();
    if (!win) return { canceled: true };
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return dialog.showSaveDialog(win, {
      defaultPath: `invoicepro-backup-${timestamp}.db`,
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    });
  });

  ipcMain.handle(IPC_CHANNELS.BACKUP.CHOOSE_RESTORE_FILE, async () => {
    const win = getMainWindow();
    if (!win) return { canceled: true };
    return dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    });
  });

  ipcMain.handle(
    IPC_CHANNELS.BACKUP.CREATE,
    safe(async (event, token, destinationPath) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;
      if (!destinationPath)
        return { success: false, error: { code: "VALIDATION_ERROR", message: "Destination path is required" } };

      // better-sqlite3's online backup API — takes a consistent snapshot of
      // the live database (including anything still sitting in the WAL)
      // without needing to stop the app or lock out other operations. Never
      // a raw file copy, which could catch mid-write state.
      await db.db.backup(destinationPath);
      log.info("Backup created at", destinationPath);
      return { success: true, data: { path: destinationPath } };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.BACKUP.VALIDATE_RESTORE_FILE,
    safe((event, token, filePath) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;
      return { success: true, data: validateBackupFile(filePath) };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.BACKUP.LIST_AUTO_BACKUPS,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const backupsDir = path.join(app.getPath("userData"), "backups");
      if (!fs.existsSync(backupsDir)) return { success: true, data: [] };

      const data = fs
        .readdirSync(backupsDir)
        .filter((f) => f.endsWith(".db"))
        .map((f) => {
          const stat = fs.statSync(path.join(backupsDir, f));
          return { name: f, size: stat.size, createdAt: stat.birthtime };
        })
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return { success: true, data };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.BACKUP.RESTORE,
    safe(async (event, token, filePath) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;

      const validation = validateBackupFile(filePath);
      if (!validation.valid)
        return { success: false, error: { code: "INVALID_BACKUP", message: validation.reason } };

      const userDataPath = app.getPath("userData");
      const dbPath = path.join(userDataPath, "invoicepro.db");
      const backupsDir = path.join(userDataPath, "backups");
      fs.mkdirSync(backupsDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safetyBackupPath = path.join(backupsDir, `pre-restore-${timestamp}.db`);

      try {
        // 1. Never touch the live file until we have a known-good copy of
        // what's about to be replaced.
        await db.db.backup(safetyBackupPath);
        log.info("Pre-restore safety backup created at", safetyBackupPath);

        // 2. Fold the WAL into the main file and close the handle so
        // nothing can write to it while we swap files underneath it.
        db.db.pragma("wal_checkpoint(TRUNCATE)");
        db.db.close();

        // 3. Stale -wal/-shm sidecars belong to the OLD file's write-ahead
        // log — replaying them against the newly-copied-in file would
        // corrupt it, so they must not survive the swap.
        for (const ext of ["-wal", "-shm"]) {
          const sidecar = dbPath + ext;
          if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
        }

        // 4. Swap in the validated backup.
        fs.copyFileSync(filePath, dbPath);
        log.info("Database restored from", filePath);
      } catch (err) {
        log.error("Restore failed:", err);
        return { success: false, error: { code: "RESTORE_FAILED", message: err.message } };
      }

      // 5. Relaunch to a fully clean boot against the new file — this also
      // naturally re-runs migrations if the restored backup predates some,
      // and guarantees no stale renderer/IPC state survives the swap.
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 300);

      return { success: true, data: { safetyBackupPath } };
    }),
  );
}
