const bcrypt = require("bcryptjs");
const log = require("electron-log");
const { SESSION_EXPIRY_MS, DEFAULT_ADMIN } = require("../shared/constants");
const { generateSessionToken } = require("../shared/utils");

// In-memory session store
const sessions = new Map();

function login(db, username, password) {
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

  // Generate session token
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
      user: {
        id: user.id,
        username: user.username,
        companyName: user.company_name,
        companyAddress: user.company_address,
        companyPhone: user.company_phone,
        companyEmail: user.company_email,
        logoPath: user.logo_path,
      },
    },
  };
}

function logout(token) {
  if (sessions.has(token)) {
    sessions.delete(token);
    log.info("User logged out");
  }
  return { success: true };
}

function validateSession(token) {
  const session = sessions.get(token);
  if (!session) {
    return { valid: false };
  }
  if (Date.now() > session.expiry) {
    sessions.delete(token);
    return { valid: false };
  }
  // Refresh expiry
  session.expiry = Date.now() + SESSION_EXPIRY_MS;
  sessions.set(token, session);
  return { valid: true, userId: session.userId };
}

function getSettings(db, userId) {
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
  return { success: true, data: user };
}

function updateSettings(db, userId, settings) {
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

  return { success: true, data: getSettings(db, userId).data };
}

module.exports = {
  login,
  logout,
  validateSession,
  getSettings,
  updateSettings,
  sessions,
};
