const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const log = require("electron-log");
const Database = require("./database");
const { setupIpcHandlers } = require("./ipc-handlers");
const { validateSession, sessions } = require("./auth");

// Configure logging
log.transports.file.level = "info";
log.transports.file.resolvePathFn = () =>
  path.join(app.getPath("userData"), "logs", "main.log");

// Global exception handler
process.on("uncaughtException", (error) => {
  log.error("Uncaught Exception:", error);
  app.exit(1);
});

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled Rejection:", reason);
});

let mainWindow;
let db;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    log.info("Main window displayed");
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  log.info("InvoicePro starting...");

  // Initialize database
  db = new Database();
  log.info("Database initialized");

  // Setup IPC handlers
  setupIpcHandlers(db, sessions);

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Handle PDF download requests
ipcMain.handle("dialog:save-file", async (event, { defaultPath, filters }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters: filters || [{ name: "PDF Files", extensions: ["pdf"] }],
  });
  return result;
});

// Handle writing PDF buffer to file
ipcMain.handle("file:write-pdf", async (event, { filePath, buffer }) => {
  const fs = require("fs");
  try {
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return { success: true };
  } catch (error) {
    log.error("Failed to write PDF:", error);
    return { success: false, error: error.message };
  }
});

module.exports = { mainWindow };
