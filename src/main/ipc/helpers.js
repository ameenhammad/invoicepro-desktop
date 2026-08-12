import log from "electron-log";
import { validateSession } from "../auth.js";

// Reusable auth check
export function requireAuth(token) {
  const session = validateSession(token);
  if (!session.valid) {
    return {
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Not authenticated" },
    };
  }
  return { ok: true, userId: session.userId };
}

// Reusable try/catch wrapper for IPC handlers
export function safe(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      log.error("IPC handler error:", err);
      return {
        success: false,
        error: { code: "INTERNAL_ERROR", message: err.message },
      };
    }
  };
}
