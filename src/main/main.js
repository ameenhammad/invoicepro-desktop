import { app, BrowserWindow } from "electron";
import path from "path";
import log from "electron-log";
import Database from "./database.js";
import { setupIpcHandlers } from "./ipc/index.js";
import { registerFileHandlers } from "./file-ipc.js";
import { registerBackupHandlers } from "./backup.ipc.js";
import { createMainWindow } from "./window.js";

// Configure logging
log.transports.file.level = "info";
log.transports.file.resolvePathFn = () =>
  path.join(app.getPath("userData"), "logs", "main.log");

let mainWindow;
let db;

function gracefulShutdown(exitCode = 0) {
  try {
    if (db && db.db) {
      db.db.close();
      log.info("Database closed gracefully");
    }
  } catch (err) {
    log.error("Error closing database:", err);
  }
  app.exit(exitCode);
}

process.on("uncaughtException", (error) => {
  log.error("Uncaught Exception:", error);
  gracefulShutdown(1);
});

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled Rejection:", reason);
});

app.whenReady().then(() => {
  log.info("InvoicePro starting...");

  try {
    db = new Database();
    log.info("Database initialized");
  } catch (err) {
    log.error("Failed to initialize database:", err);
    gracefulShutdown(1);
    return;
  }

  setupIpcHandlers(db);
  registerFileHandlers(() => mainWindow);
  registerBackupHandlers(db, () => mainWindow);

  mainWindow = createMainWindow({ onClosed: () => (mainWindow = null) });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow({ onClosed: () => (mainWindow = null) });
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("quit", () => {
  if (db && db.db) {
    try {
      db.db.close();
      log.info("Database closed on quit");
    } catch (err) {
      log.error("Error closing database on quit:", err);
    }
  }
});
