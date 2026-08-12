import { ipcMain } from "electron";
import {
  login,
  logout,
  validateSession,
  getSettings,
  updateSettings,
  changePassword,
} from "../auth.js";
import { IPC_CHANNELS } from "../../shared/constants.js";
import { requireAuth, safe } from "./helpers.js";

export function registerAuthHandlers(db) {
  ipcMain.handle(
    IPC_CHANNELS.AUTH.LOGIN,
    safe((event, username, password) => login(db, username, password)),
  );

  ipcMain.handle(
    IPC_CHANNELS.AUTH.LOGOUT,
    safe((event, token) => logout(token)),
  );

  ipcMain.handle(
    IPC_CHANNELS.AUTH.CHECK,
    safe((event, token) => validateSession(token)),
  );

  ipcMain.handle(
    IPC_CHANNELS.AUTH.GET_SETTINGS,
    safe((event, token) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;
      return getSettings(db, auth.userId);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.AUTH.UPDATE_SETTINGS,
    safe((event, token, settings) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;
      return updateSettings(db, auth.userId, settings);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.AUTH.CHANGE_PASSWORD,
    safe((event, token, currentPassword, newPassword) => {
      const auth = requireAuth(token);
      if (!auth.ok) return auth.error;
      return changePassword(db, auth.userId, currentPassword, newPassword);
    }),
  );
}
