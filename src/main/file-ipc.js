import { ipcMain, dialog } from "electron";
import fs from "fs";
import log from "electron-log";

// OS-level dialog and file-write handlers used for saving generated PDFs.
export function registerFileHandlers(getMainWindow) {
  ipcMain.handle(
    "dialog:save-file",
    async (event, { defaultPath, filters }) => {
      const win = getMainWindow();
      if (!win) {
        return { canceled: true };
      }
      const result = await dialog.showSaveDialog(win, {
        defaultPath,
        filters: filters || [{ name: "PDF Files", extensions: ["pdf"] }],
      });
      return result;
    },
  );

  ipcMain.handle("file:write-pdf", async (event, { filePath, buffer }) => {
    try {
      // IPC serializes a Buffer as { type: 'Buffer', data: [...] } — handle both forms.
      const data = Buffer.isBuffer(buffer)
        ? buffer
        : Buffer.from(buffer.data ?? buffer);
      fs.writeFileSync(filePath, data);
      return { success: true };
    } catch (error) {
      log.error("Failed to write PDF:", error);
      return { success: false, error: error.message };
    }
  });
}
