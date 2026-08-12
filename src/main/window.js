import { app, BrowserWindow, Menu } from "electron";
import path from "path";
import log from "electron-log";

export function createMainWindow({ onClosed } = {}) {
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    // Linux/AppImage windows don't reliably inherit the desktop-file icon
    // for the window/taskbar entry; Windows/mac get theirs from the
    // installer-embedded executable icon instead.
    icon: path.join(app.getAppPath(), "build/icon.png"),
    webPreferences: {
      // Use app.getAppPath() for reliable path resolution in packaged builds.
      // Must be .cjs: Electron loads preload scripts via CommonJS require()
      // regardless of this project's "type": "module" setting.
      preload: path.join(app.getAppPath(), "src/main/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Sandboxed preload can still `require("electron")` (Electron polyfills
      // that one call) — this preload does nothing else, so full OS sandboxing
      // applies with no functional loss.
      sandbox: true,
      devTools: !app.isPackaged,
    },
    show: false,
  });

  win.loadFile(path.join(app.getAppPath(), "src/renderer/index.html"));

  // Preload failures otherwise fail silently, leaving window.api undefined
  // with no visible error anywhere.
  win.webContents.on("preload-error", (event, preloadPath, error) => {
    log.error("Preload script failed to load:", preloadPath, error);
  });

  win.once("ready-to-show", () => {
    win.show();
    log.info("Main window displayed");
  });

  win.on("closed", () => onClosed?.());

  return win;
}
