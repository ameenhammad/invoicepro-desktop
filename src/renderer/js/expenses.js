import { state } from "./state.js";
import { escapeHtml, formatCurrency, formatDate } from "../../shared/utils.js";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from "../../shared/constants.js";
import { showModal, closeModal, modalTitle, modalBody, modalFooter } from "./modal.js";

let expenses = [];

export async function loadExpenses() {
  const scopeFilter = document.getElementById("expense-scope-filter")?.value || "business";
  const categoryFilter = document.getElementById("expense-category-filter")?.value || "";

  const filters = {};
  if (scopeFilter !== "all") filters.scope = scopeFilter;
  if (categoryFilter) filters.category = categoryFilter;

  const result = await window.api.expenses.getAll(state.sessionToken, filters);
  if (!result.success) return;
  expenses = result.data;

  const tbody = document.getElementById("expenses-body");
  tbody.innerHTML =
    expenses
      .map(
        (e) => `
    <tr>
      <td>${formatDate(e.expense_date)}</td>
      <td>${escapeHtml(e.category)}</td>
      <td>${escapeHtml(e.description || "-")}</td>
      <td>${formatCurrency(e.amount)}</td>
      <td>${e.accounting_month}</td>
      <td><span class="badge ${e.scope === "personal" ? "badge-muted" : "badge-success"}">${e.scope === "personal" ? "Personal" : "Business"}</span></td>
      <td><span class="status-badge ${e.status}">${e.status}</span></td>
      <td class="actions" data-id="${e.id}">
        <button class="edit-expense-btn">Edit</button>
        <button class="delete delete-expense-btn">Delete</button>
      </td>
    </tr>
  `,
      )
      .join("") || `<tr><td colspan="8" class="text-muted">No expenses recorded yet</td></tr>`;

  tbody.querySelectorAll(".edit-expense-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.closest("td").dataset.id);
      const expense = expenses.find((e) => e.id === id);
      showExpenseModal(expense);
    });
  });
  tbody.querySelectorAll(".delete-expense-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.closest("td").dataset.id);
      deleteExpense(id);
    });
  });
}

async function deleteExpense(id) {
  if (confirm("Delete this expense? Any ledger entry it created will be removed too.")) {
    await window.api.expenses.delete(state.sessionToken, id);
    loadExpenses();
  }
}

document.getElementById("add-expense-btn")?.addEventListener("click", () => showExpenseModal());
document.getElementById("expense-scope-filter")?.addEventListener("change", () => loadExpenses());
document.getElementById("expense-category-filter")?.addEventListener("change", () => loadExpenses());

// `expense` may be a full existing expense row (has an id -> editing) or a
// partial prefill object with no id (e.g. { worker_id, category, amount }
// from "Record Wage Payment" on a worker's detail page) -> still a new one.
export async function showExpenseModal(expense = null) {
  const today = new Date().toISOString().split("T")[0];
  const expenseDate = expense?.expense_date || today;
  const isEditing = !!expense?.id;

  const [projectsResult, workersResult] = await Promise.all([
    window.api.projects.getAll(state.sessionToken),
    window.api.workers.getAll(state.sessionToken),
  ]);
  const projects = projectsResult.success ? projectsResult.data : [];
  const workers = workersResult.success ? workersResult.data : [];

  modalTitle.textContent = isEditing ? "Edit Expense" : "Add Expense";
  modalBody.innerHTML = `
    <form id="expense-form">
      <div class="form-row">
        <div class="form-group">
          <label for="expense-amount">Amount *</label>
          <input type="number" id="expense-amount" required step="0.01" min="0.01" value="${expense ? expense.amount : ""}">
        </div>
        <div class="form-group">
          <label for="expense-category">Category</label>
          <select id="expense-category">
            ${EXPENSE_CATEGORIES.map(
              (cat) => `<option value="${cat}" ${(expense?.category || "Materials") === cat ? "selected" : ""}>${cat}</option>`,
            ).join("")}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="expense-date">Date</label>
          <input type="date" id="expense-date" value="${expenseDate}">
        </div>
        <div class="form-group">
          <label for="expense-accounting-month">Accounting Month</label>
          <input type="month" id="expense-accounting-month" value="${expense?.accounting_month || expenseDate.slice(0, 7)}">
          <small class="helper-text">Which month this should count toward — defaults to the expense date's month, override for late-booked bills (e.g. rent paid early for next month).</small>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="expense-method">Payment Method</label>
          <select id="expense-method">
            ${Object.values(PAYMENT_METHODS)
              .map(
                (m) =>
                  `<option value="${m}" ${(expense?.method || "cash") === m ? "selected" : ""}>${m
                    .split("_")
                    .map((w) => w[0].toUpperCase() + w.slice(1))
                    .join(" ")}</option>`,
              )
              .join("")}
          </select>
        </div>
        <div class="form-group">
          <label for="expense-scope">Business / Personal</label>
          <select id="expense-scope">
            <option value="business" ${(expense?.scope || "business") === "business" ? "selected" : ""}>Business</option>
            <option value="personal" ${expense?.scope === "personal" ? "selected" : ""}>Personal</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="expense-project">Project (optional)</label>
          <select id="expense-project">
            <option value="">Not linked to a project</option>
            ${projects
              .map(
                (p) =>
                  `<option value="${p.id}" ${expense?.project_id === p.id ? "selected" : ""}>${escapeHtml(p.project_number)} — ${escapeHtml(p.name)}</option>`,
              )
              .join("")}
          </select>
        </div>
        <div class="form-group">
          <label for="expense-worker">Worker (optional)</label>
          <select id="expense-worker">
            <option value="">Not a wage payment</option>
            ${workers
              .map(
                (w) =>
                  `<option value="${w.id}" ${expense?.worker_id === w.id ? "selected" : ""}>${escapeHtml(w.name)}${w.role ? ` (${escapeHtml(w.role)})` : ""}</option>`,
              )
              .join("")}
          </select>
          <small class="helper-text">Selecting a worker records this as a wage payment (category auto-set to Worker Wages).</small>
        </div>
      </div>
      <div class="form-group">
        <label for="expense-description">Description</label>
        <textarea id="expense-description">${expense ? escapeHtml(expense.description || "") : ""}</textarea>
      </div>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="expense-paid" ${!expense || expense.status === "paid" ? "checked" : ""}>
          Paid — record this as cash out now
        </label>
        <small class="helper-text">Leave unchecked for a bill you owe but haven't paid yet; nothing posts to cash flow until it's marked paid.</small>
      </div>
    </form>
  `;
  modalFooter.innerHTML = `
    <button class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
    <button class="btn btn-primary" id="modal-save-expense-btn">Save</button>
  `;
  document.getElementById("modal-cancel-btn")?.addEventListener("click", closeModal);
  document
    .getElementById("expense-worker")
    ?.addEventListener("change", (e) => {
      if (e.target.value) document.getElementById("expense-category").value = "Worker Wages";
    });
  document
    .getElementById("modal-save-expense-btn")
    ?.addEventListener("click", () => saveExpense(isEditing ? expense.id : null));
  showModal();
}

async function saveExpense(id) {
  const amount = parseFloat(document.getElementById("expense-amount").value);
  if (!amount || amount <= 0) {
    alert("Amount must be positive");
    return;
  }

  const projectValue = document.getElementById("expense-project").value;
  const workerValue = document.getElementById("expense-worker").value;

  const data = {
    amount,
    category: document.getElementById("expense-category").value,
    expense_date: document.getElementById("expense-date").value,
    accounting_month: document.getElementById("expense-accounting-month").value,
    method: document.getElementById("expense-method").value,
    scope: document.getElementById("expense-scope").value,
    description: document.getElementById("expense-description").value,
    status: document.getElementById("expense-paid").checked ? "paid" : "unpaid",
    project_id: projectValue ? parseInt(projectValue) : null,
    worker_id: workerValue ? parseInt(workerValue) : null,
  };

  const result = id
    ? await window.api.expenses.update(state.sessionToken, id, data)
    : await window.api.expenses.create(state.sessionToken, data);

  if (result.success) {
    closeModal();
    if (state.currentView === "view-worker" && workerValue) {
      // Refresh the worker detail page if this payment came from its
      // "Record Wage Payment" action, so the new payment shows immediately.
      const { viewWorker } = await import("./workers.js");
      viewWorker(parseInt(workerValue));
    }
    loadExpenses();
  } else {
    alert(result.error?.message || "Failed to save expense");
  }
}
