import { state } from "./state.js";
import { escapeHtml, formatCurrency, formatDate } from "../../shared/utils.js";
import { WAGE_TYPE } from "../../shared/constants.js";
import { showModal, closeModal, modalTitle, modalBody, modalFooter } from "./modal.js";
import { navigateTo } from "./navigation.js";
import { showExpenseModal } from "./expenses.js";

let workers = [];
let currentWorkerId = null;

const WAGE_TYPE_LABELS = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  per_job: "Per Job",
  other: "Other",
};

export async function loadWorkers() {
  const searchInput = document.getElementById("worker-search");
  const search = searchInput ? searchInput.value : "";
  const result = await window.api.workers.getAll(state.sessionToken, search);
  if (!result.success) return;
  workers = result.data;

  const tbody = document.getElementById("workers-body");
  tbody.innerHTML =
    workers
      .map(
        (w) => `
    <tr>
      <td>${escapeHtml(w.name)}</td>
      <td>${escapeHtml(w.role || "-")}</td>
      <td>${WAGE_TYPE_LABELS[w.wage_type] || w.wage_type}</td>
      <td>${formatCurrency(w.default_rate)}</td>
      <td class="actions" data-id="${w.id}">
        <button class="view-worker-btn">View</button>
        <button class="edit-worker-btn">Edit</button>
        <button class="delete delete-worker-btn">Delete</button>
      </td>
    </tr>
  `,
      )
      .join("") || `<tr><td colspan="5" class="text-muted">No workers yet</td></tr>`;

  tbody.querySelectorAll(".view-worker-btn").forEach((btn) => {
    btn.addEventListener("click", () => viewWorker(parseInt(btn.closest("td").dataset.id)));
  });
  tbody.querySelectorAll(".edit-worker-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.closest("td").dataset.id);
      showWorkerModal(workers.find((w) => w.id === id));
    });
  });
  tbody.querySelectorAll(".delete-worker-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteWorker(parseInt(btn.closest("td").dataset.id)));
  });
}

async function deleteWorker(id) {
  if (confirm("Are you sure you want to remove this worker?")) {
    await window.api.workers.delete(state.sessionToken, id);
    loadWorkers();
  }
}

document.getElementById("add-worker-btn")?.addEventListener("click", () => showWorkerModal());
document.getElementById("worker-search")?.addEventListener("input", () => loadWorkers());

function showWorkerModal(worker = null) {
  modalTitle.textContent = worker ? "Edit Worker" : "Add Worker";
  modalBody.innerHTML = `
    <form id="worker-form">
      <div class="form-row">
        <div class="form-group">
          <label for="worker-name">Worker Name *</label>
          <input type="text" id="worker-name" required value="${worker ? escapeHtml(worker.name) : ""}">
        </div>
        <div class="form-group">
          <label for="worker-phone">Phone</label>
          <input type="text" id="worker-phone" value="${worker ? escapeHtml(worker.phone || "") : ""}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="worker-role">Role</label>
          <input type="text" id="worker-role" placeholder="e.g. Carpenter" value="${worker ? escapeHtml(worker.role || "") : ""}">
        </div>
        <div class="form-group">
          <label for="worker-wage-type">Wage Type</label>
          <select id="worker-wage-type">
            ${Object.entries(WAGE_TYPE_LABELS)
              .map(([val, label]) => `<option value="${val}" ${(worker?.wage_type || WAGE_TYPE.DAILY) === val ? "selected" : ""}>${label}</option>`)
              .join("")}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label for="worker-default-rate">Default Rate</label>
        <input type="number" id="worker-default-rate" step="0.01" min="0" value="${worker ? worker.default_rate : "0"}">
      </div>
      <div class="form-group">
        <label for="worker-notes">Notes</label>
        <textarea id="worker-notes">${worker ? escapeHtml(worker.notes || "") : ""}</textarea>
      </div>
      ${
        worker
          ? `<div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="worker-active" ${worker.is_active ? "checked" : ""}>
          Active
        </label>
      </div>`
          : ""
      }
    </form>
  `;
  modalFooter.innerHTML = `
    <button class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
    <button class="btn btn-primary" id="modal-save-worker-btn">Save</button>
  `;
  document.getElementById("modal-cancel-btn")?.addEventListener("click", closeModal);
  document
    .getElementById("modal-save-worker-btn")
    ?.addEventListener("click", () => saveWorker(worker ? worker.id : null));
  showModal();
}

async function saveWorker(id) {
  const data = {
    name: document.getElementById("worker-name").value,
    phone: document.getElementById("worker-phone").value,
    role: document.getElementById("worker-role").value,
    wage_type: document.getElementById("worker-wage-type").value,
    default_rate: parseFloat(document.getElementById("worker-default-rate").value) || 0,
    notes: document.getElementById("worker-notes").value,
  };
  if (id) {
    data.is_active = document.getElementById("worker-active").checked ? 1 : 0;
  }

  if (!data.name) {
    alert("Worker name is required");
    return;
  }

  const result = id
    ? await window.api.workers.update(state.sessionToken, id, data)
    : await window.api.workers.create(state.sessionToken, data);

  if (result.success) {
    closeModal();
    if (id && state.currentView === "view-worker") {
      viewWorker(id);
    } else {
      loadWorkers();
    }
  } else {
    alert(result.error?.message || "Failed to save worker");
  }
}

export async function viewWorker(id) {
  currentWorkerId = id;
  const result = await window.api.workers.get(state.sessionToken, id);
  if (!result.success) return;

  const w = result.data;
  document.getElementById("vw-title").textContent = w.name;
  document.getElementById("vw-role").textContent = w.role || "-";
  document.getElementById("vw-wage-type").textContent = WAGE_TYPE_LABELS[w.wage_type] || w.wage_type;
  document.getElementById("vw-default-rate").textContent = formatCurrency(w.default_rate);
  document.getElementById("vw-wages-paid").textContent = formatCurrency(w.wagesPaid);

  document.getElementById("vw-payments-body").innerHTML =
    w.recentPayments
      .map(
        (p) => `
      <tr>
        <td>${formatDate(p.expense_date)}</td>
        <td>${formatCurrency(p.amount)}</td>
        <td><span class="status-badge ${p.status}">${p.status}</span></td>
        <td>${escapeHtml(p.description || "-")}</td>
      </tr>
    `,
      )
      .join("") || `<tr><td colspan="4" class="text-muted">No wage payments recorded yet</td></tr>`;

  document.getElementById("vw-edit-btn").onclick = () => showWorkerModal(w);
  document.getElementById("vw-back-btn").onclick = () => navigateTo("workers");
  document.getElementById("vw-record-payment-btn").onclick = () =>
    showExpenseModal({ worker_id: w.id, category: "Worker Wages", amount: w.default_rate });

  navigateTo("view-worker");
}
