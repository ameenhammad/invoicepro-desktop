import bcrypt from "bcryptjs";
import log from "electron-log";
import { randomBytes } from "crypto";
import { SESSION_EXPIRY_MS } from "../shared/constants.js";

function generateSessionToken() {
  return randomBytes(32).toString("hex");
}

// In-memory session store
const sessions = new Map();

// Helper to map DB user row to camelCase
function mapUser(user) {
  return {
    id: user.id,
    username: user.username,
    companyName: user.company_name,
    companyAddress: user.company_address,
    companyPhone: user.company_phone,
    companyEmail: user.company_email,
    logoPath: user.logo_path,
  };
}

export function login(db, username, password) {
  const user = db.get("SELECT * FROM users WHERE username = ?", [username]);

  if (!user) {
    return {
      success: false,
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Invalid username or password",
      },
    };
  }

  const valid = bcrypt.compareSync(password, user.password_hash);

  if (!valid) {
    return {
      success: false,
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Invalid username or password",
      },
    };
  }

  const token = generateSessionToken();
  const expiry = Date.now() + SESSION_EXPIRY_MS;

  sessions.set(token, {
    userId: user.id,
    username: user.username,
    expiry,
  });

  log.info("User logged in:", username);

  return {
    success: true,
    data: {
      token,
      user: mapUser(user),
    },
  };
}

export function logout(token) {
  if (token && sessions.has(token)) {
    sessions.delete(token);
    log.info("User logged out");
  }
  return { success: true };
}

export function validateSession(token) {
  const session = sessions.get(token);
  if (!session) {
    return { valid: false };
  }
  if (Date.now() > session.expiry) {
    sessions.delete(token);
    return { valid: false };
  }
  // Refresh expiry on activity
  session.expiry = Date.now() + SESSION_EXPIRY_MS;
  sessions.set(token, session);
  return { valid: true, userId: session.userId };
}

export function getSettings(db, userId) {
  const user = db.get(
    "SELECT id, username, company_name, company_address, company_phone, company_email, logo_path FROM users WHERE id = ?",
    [userId],
  );
  if (!user) {
    return {
      success: false,
      error: { code: "NOT_FOUND", message: "User not found" },
    };
  }
  // FIX: return camelCase mapped user, consistent with login response
  return { success: true, data: mapUser(user) };
}

export function updateSettings(db, userId, settings) {
  const allowedFields = [
    "company_name",
    "company_address",
    "company_phone",
    "company_email",
    "logo_path",
  ];
  const updates = [];
  const values = [];

  for (const [key, value] of Object.entries(settings)) {
    if (allowedFields.includes(key)) {
      updates.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (updates.length === 0) {
    return {
      success: false,
      error: { code: "NO_UPDATES", message: "No valid fields to update" },
    };
  }

  values.push(userId);
  db.run(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, values);

  // FIX: getSettings now returns camelCase, so this is consistent
  return { success: true, data: getSettings(db, userId).data };
}

export function changePassword(db, userId, currentPassword, newPassword) {
  // FIX: validate newPassword before hashing
  if (!newPassword || newPassword.trim().length === 0) {
    return {
      success: false,
      error: {
        code: "INVALID_PASSWORD",
        message: "New password cannot be empty",
      },
    };
  }

  const user = db.get("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) {
    return {
      success: false,
      error: { code: "NOT_FOUND", message: "User not found" },
    };
  }

  const valid = bcrypt.compareSync(currentPassword, user.password_hash);
  if (!valid) {
    return {
      success: false,
      error: {
        code: "INVALID_PASSWORD",
        message: "Current password is incorrect",
      },
    };
  }

  const hash = bcrypt.hashSync(newPassword, 12);
  db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, userId]);

  log.info("Password changed for user:", userId);
  return { success: true };
}

export { sessions };
