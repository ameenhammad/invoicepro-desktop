import { state } from "./state.js";
import { escapeHtml, formatDate } from "../../shared/utils.js";

export async function loadSettings() {
  const result = await window.api.auth.getSettings(state.sessionToken);
  if (result.success) {
    document.getElementById("company-name").value =
      result.data.companyName || "";
    document.getElementById("company-address").value =
      result.data.companyAddress || "";
    document.getElementById("company-phone").value =
      result.data.companyPhone || "";
    document.getElementById("company-email").value =
      result.data.companyEmail || "";
  }

  await loadWorkshopDefaults();
  await loadAutoBackups();
}

async function loadWorkshopDefaults() {
  const [clientsResult, settingsResult] = await Promise.all([
    window.api.clients.getAll(state.sessionToken),
    window.api.settings.getAppSettings(state.sessionToken),
  ]);

  if (clientsResult.success) {
    const select = document.getElementById("default-walkin-client");
    select.innerHTML = clientsResult.data
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
      .join("");
  }

  if (settingsResult.success) {
    state.appSettings = settingsResult.data;
    const s = settingsResult.data;
    if (s.default_walkin_client_id)
      document.getElementById("default-walkin-client").value =
        s.default_walkin_client_id;
    document.getElementById("default-payment-method").value =
      s.default_payment_method || "cash";
    document.getElementById("invoice-prefix-setting").value =
      s.invoice_prefix || "INV";
    document.getElementById("currency-symbol-setting").value =
      s.currency_symbol || "Rs.";
    document.getElementById("tax-rate-setting").value = s.tax_rate || "0";
  }
}

document
  .getElementById("workshop-settings-form")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const updates = {
      default_walkin_client_id: document.getElementById("default-walkin-client")
        .value,
      default_payment_method: document.getElementById("default-payment-method")
        .value,
      invoice_prefix: document.getElementById("invoice-prefix-setting").value,
      currency_symbol: document.getElementById("currency-symbol-setting").value,
      tax_rate: document.getElementById("tax-rate-setting").value,
    };
    const result = await window.api.settings.updateAppSettings(
      state.sessionToken,
      updates,
    );
    if (result.success) {
      state.appSettings = result.data;
      alert("Workshop defaults saved successfully");
    } else {
      alert(result.error?.message || "Failed to save workshop defaults");
    }
  });

document
  .getElementById("settings-form")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const settings = {
      company_name: document.getElementById("company-name").value,
      company_address: document.getElementById("company-address").value,
      company_phone: document.getElementById("company-phone").value,
      company_email: document.getElementById("company-email").value,
    };
    const result = await window.api.auth.updateSettings(
      state.sessionToken,
      settings,
    );
    if (result.success) alert("Settings saved successfully");
    else alert(result.error?.message || "Failed to save settings");
  });

document
  .getElementById("change-password-form")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById("current-password").value;
    const newPassword = document.getElementById("new-password").value;
    const confirmPassword = document.getElementById("confirm-password").value;
    const errorEl = document.getElementById("password-error");
    errorEl.textContent = "";

    if (!currentPassword || !newPassword) {
      errorEl.textContent = "All fields are required";
      return;
    }
    if (newPassword !== confirmPassword) {
      errorEl.textContent = "New passwords do not match";
      return;
    }
    if (newPassword.length < 6) {
      errorEl.textContent = "Password must be at least 6 characters";
      return;
    }

    const result = await window.api.auth.changePassword(
      state.sessionToken,
      currentPassword,
      newPassword,
    );
    if (result.success) {
      alert("Password changed successfully");
      document.getElementById("change-password-form").reset();
    } else {
      errorEl.textContent =
        result.error?.message || "Failed to change password";
    }
  });

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadAutoBackups() {
  const result = await window.api.backup.listAutoBackups(state.sessionToken);
  const body = document.getElementById("auto-backups-body");
  if (!body) return;
  if (!result.success) return;
  body.innerHTML =
    result.data
      .map(
        (f) => `
      <tr>
        <td>${escapeHtml(f.name)}</td>
        <td>${formatBytes(f.size)}</td>
        <td>${formatDate(f.createdAt)}</td>
      </tr>
    `,
      )
      .join("") || `<tr><td colspan="3" class="text-muted">No safety backups yet — created automatically before a restore</td></tr>`;
}

document.getElementById("create-backup-btn")?.addEventListener("click", async () => {
  const statusEl = document.getElementById("backup-status");
  statusEl.textContent = "";

  const dialogResult = await window.api.backup.chooseDestination();
  if (dialogResult.canceled || !dialogResult.filePath) return;

  statusEl.textContent = "Creating backup…";
  const result = await window.api.backup.create(state.sessionToken, dialogResult.filePath);
  if (result.success) {
    statusEl.textContent = `Backup created: ${result.data.path}`;
  } else {
    statusEl.textContent = `Backup failed: ${result.error?.message || "unknown error"}`;
  }
});

document.getElementById("restore-backup-btn")?.addEventListener("click", async () => {
  const statusEl = document.getElementById("restore-status");
  statusEl.textContent = "";

  const dialogResult = await window.api.backup.chooseRestoreFile();
  if (dialogResult.canceled || !dialogResult.filePaths?.length) return;
  const filePath = dialogResult.filePaths[0];

  statusEl.textContent = "Validating backup file…";
  const validation = await window.api.backup.validateRestoreFile(state.sessionToken, filePath);
  if (!validation.success || !validation.data.valid) {
    statusEl.textContent = `Not a valid backup: ${validation.data?.reason || validation.error?.message || "unknown"}`;
    return;
  }

  const confirmed = confirm(
    "This will REPLACE everything currently in InvoicePro with the contents of this backup file. " +
      "A safety copy of the current database will be made automatically first, but this action cannot be undone from within the app. " +
      "The app will restart immediately after. Continue?",
  );
  if (!confirmed) {
    statusEl.textContent = "Restore cancelled.";
    return;
  }

  statusEl.textContent = "Restoring — the app will restart in a moment…";
  const result = await window.api.backup.restore(state.sessionToken, filePath);
  if (!result.success) {
    statusEl.textContent = `Restore failed: ${result.error?.message || "unknown error"}`;
  }
  // On success the main process relaunches the whole app shortly after
  // this response — nothing further to do here.
});
